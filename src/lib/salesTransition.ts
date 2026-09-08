import mongoose from "mongoose";
import SalesOrder from "@/models/SalesOrder";
import { writeAudit } from "@/lib/audit";
import { authorityFor, stageComplete, nextStageIndex, stagesAt, type Actor, type OrderLike, type StageDef } from "@/lib/salesWorkflow";
import { liveDelegationRoles, isRoleUnavailable } from "@/lib/salesAuth";

/**
 * Every stage transition, done atomically.
 *
 * NEVER read-modify-write. Two managers clicking approve on stage 7 within the
 * same second is not a hypothetical — it is the normal case for a joint gate.
 * Each transition is a CONDITIONAL update whose filter asserts the precondition
 * it depends on; a `null` result means someone got there first, which the
 * caller surfaces as a 409 rather than silently overwriting.
 */

export type TransitionError =
  | { code: "not_found" }
  | { code: "terminal" }
  | { code: "forbidden" }
  | { code: "raced" };

export interface ClaimResult {
  order: Record<string, unknown>;
  stage: StageDef;
  actedAs: string;
  actedForRole: string;
  advancedTo: number | null;
  posted: boolean;
}

/** Which live slot at the current stage may this actor act on, and how. */
export async function resolveSlot(
  order: OrderLike,
  actor: Actor,
  wantKind?: StageDef["kind"]
): Promise<{ stage: StageDef; actedAs: string; actedForRole: string } | TransitionError> {
  if (order.status !== "Pending") return { code: "terminal" };

  const delegated = await liveDelegationRoles(actor.id);

  const live = stagesAt(order.currentStageIndex).filter(
    (s) => order.steps.find((st) => st.stageKey === s.key)?.status === "pending"
  );

  for (const stage of live) {
    if (wantKind && stage.kind !== wantKind) continue;
    const absent = stage.deputyRole ? await isRoleUnavailable(stage.role) : false;
    const authority = authorityFor(stage, actor, {
      liveDelegationRoles: delegated,
      primaryRoleIsAbsent: absent,
    });
    if (!authority) continue;

    return {
      stage,
      actedAs: authority.kind,
      // Recording WHO the signature was made on behalf of is the whole point:
      // a deputy's mark that looked like the owner's would hollow out the chain.
      actedForRole: "forRole" in authority ? authority.forRole : stage.role,
    };
  }

  return { code: "forbidden" };
}

/**
 * Claim one slot, then advance the stage only if EVERY slot at that index is
 * now satisfied.
 *
 * The two-step shape is what makes the dual sign-off work without a lock: the
 * loser of a stage-7 race still claims its own slot successfully, and its
 * advance is a harmless no-op because the `currentStageIndex` precondition has
 * already moved.
 */
export async function claimAndAdvance(
  orderId: string,
  stage: StageDef,
  actor: { _id: mongoose.Types.ObjectId; name: string },
  meta: { actedAs: string; actedForRole: string; note?: string; extraSet?: Record<string, unknown> }
): Promise<ClaimResult | TransitionError> {
  const now = new Date();

  const claimed = await SalesOrder.findOneAndUpdate(
    {
      _id: orderId,
      isActive: true,
      status: "Pending",
      currentStageIndex: stage.index,
      steps: { $elemMatch: { stageKey: stage.key, status: "pending" } },
    },
    {
      $set: {
        "steps.$[s].status": stage.kind === "approval" ? "approved" : "completed",
        "steps.$[s].actedById": actor._id,
        "steps.$[s].actedByName": actor.name,
        "steps.$[s].actedAt": now,
        "steps.$[s].actedAs": meta.actedAs,
        "steps.$[s].actedForRole": meta.actedForRole,
        "steps.$[s].note": meta.note ?? "",
        ...(meta.extraSet ?? {}),
      },
    },
    {
      arrayFilters: [{ "s.stageKey": stage.key, "s.status": "pending" }],
      new: true,
    }
  ).lean();

  // Someone claimed this slot, or moved the order, between the read and now.
  if (!claimed) return { code: "raced" };

  const like = claimed as unknown as OrderLike;
  let advancedTo: number | null = null;
  let posted = false;

  if (stageComplete(like, stage.index)) {
    const next = nextStageIndex(stage.index);

    if (next === null) {
      // Stage 8: the weight and the posting land in one write, so an order can
      // never be weighed-but-not-posted.
      await SalesOrder.updateOne(
        { _id: orderId, currentStageIndex: stage.index, status: "Pending" },
        { $set: { status: "Posted", postedAt: now } }
      );
      posted = true;
    } else {
      await SalesOrder.updateOne(
        { _id: orderId, currentStageIndex: stage.index, status: "Pending" },
        {
          $set: {
            currentStageIndex: next,
            currentStageEnteredAt: now,
            // The next slots start their clock now — this is what the
            // cycle-time report measures from.
            "steps.$[n].enteredAt": now,
          },
        },
        { arrayFilters: [{ "n.stageIndex": next }] }
      );
      advancedTo = next;
    }
  }

  const fresh = await SalesOrder.findById(orderId).lean();

  await writeAudit({
    entityType: "sales_order",
    entityId: orderId,
    entityLabel: String((fresh as { orderNumber?: string })?.orderNumber ?? ""),
    action: stage.kind === "weigh" ? "weighed_posted" : stage.kind === "data_entry" ? "lab_attached" : "stage_approved",
    field: stage.key,
    oldValue: stage.index,
    newValue: advancedTo ?? (posted ? "Posted" : stage.index),
    performedBy: actor._id,
    performedByName: actor.name,
    notes:
      meta.actedAs === "primary" || meta.actedAs === "admin"
        ? meta.note ?? ""
        : `on behalf of ${meta.actedForRole}${meta.note ? ` — ${meta.note}` : ""}`,
  });

  return {
    order: fresh as Record<string, unknown>,
    stage,
    actedAs: meta.actedAs,
    actedForRole: meta.actedForRole,
    advancedTo,
    posted,
  };
}

/**
 * Rejection: terminal, in one conditional write.
 *
 * Still-pending steps become `skipped` rather than being left pending — that is
 * what lets the ladder render "never reached" honestly, and keeps
 * `stageComplete` from ever reporting true on a dead order.
 */
export async function rejectOrder(
  orderId: string,
  order: OrderLike,
  actor: { _id: mongoose.Types.ObjectId; name: string; role: string },
  reason: string,
  actedForRole: string
): Promise<Record<string, unknown> | TransitionError> {
  const now = new Date();
  const stageKey = stagesAt(order.currentStageIndex)[0]?.key ?? "";

  const rejected = await SalesOrder.findOneAndUpdate(
    { _id: orderId, isActive: true, status: "Pending" },
    {
      $set: {
        status: "Rejected",
        rejection: {
          stageIndex: order.currentStageIndex,
          stageKey,
          role: actedForRole || actor.role,
          reason,
          byId: actor._id,
          byName: actor.name,
          at: now,
        },
        "steps.$[p].status": "skipped",
      },
    },
    { arrayFilters: [{ "p.status": "pending" }], new: true }
  ).lean();

  if (!rejected) return { code: "raced" };

  // Mark the rejector's own slot as the one that killed it — distinct from the
  // downstream slots that were merely never reached.
  const own = stagesAt(order.currentStageIndex).find(
    (s) => s.role === (actedForRole || actor.role)
  );
  if (own) {
    await SalesOrder.updateOne(
      { _id: orderId },
      {
        $set: {
          "steps.$[r].status": "rejected",
          "steps.$[r].actedById": actor._id,
          "steps.$[r].actedByName": actor.name,
          "steps.$[r].actedAt": now,
          "steps.$[r].note": reason,
        },
      },
      { arrayFilters: [{ "r.stageKey": own.key }] }
    );
  }

  const fresh = await SalesOrder.findById(orderId).lean();

  await writeAudit({
    entityType: "sales_order",
    entityId: orderId,
    entityLabel: String((fresh as { orderNumber?: string })?.orderNumber ?? ""),
    action: "stage_rejected",
    field: stageKey,
    oldValue: order.currentStageIndex,
    newValue: "Rejected",
    performedBy: actor._id,
    performedByName: actor.name,
    notes: reason,
  });

  return fresh as Record<string, unknown>;
}
