import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr, conflict } from "@/lib/apiHelpers";
import { notifyRejected } from "@/lib/salesNotify";
import {
  visibilityFilter, andFilters, canReject, stagesAt, type Actor, type OrderLike,
} from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, rejectOrder } from "@/lib/salesTransition";
import SalesOrder from "@/models/SalesOrder";
import RejectionReason from "@/models/RejectionReason";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  const reasonCheck = strictStr(body?.reason, 2000, "Reason");
  if (!reasonCheck.ok) return badStrictStr(reasonCheck);
  const freeText = reasonCheck.value;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & { createdById: unknown };
  const shaped: OrderLike = {
    status: like.status,
    currentStageIndex: like.currentStageIndex,
    createdById: String(like.createdById),
    steps: like.steps,
  };

  if (shaped.status !== "Pending") return conflict("This order is already closed.");

  // The GM and admin may kill a live order at ANY stage. Everyone else needs a
  // live approval slot of their own — including via deputy or delegation.
  let actedForRole = actor.role;
  if (!canReject(shaped, actor)) {
    const slot = await resolveSlot(shaped, actor, "approval");
    if ("code" in slot) {
      return NextResponse.json({ error: "It is not your turn on this order." }, { status: 403 });
    }
    actedForRole = slot.actedForRole;
  } else if (actor.role !== "admin") {
    const own = stagesAt(shaped.currentStageIndex).find((s) => s.role === actor.role);
    actedForRole = own ? own.role : actor.role;
  }

  /**
   * The Technical Manager picks from the managed list; everybody else writes
   * freely. Keyed on `actedForRole`, not on the actor's own role, so the rule
   * follows the SIGNATURE rather than the person: a deputy or a delegate
   * rejecting in the Technical Manager's place is held to his vocabulary,
   * which is the whole point of recording whose authority was used.
   *
   * An admin override resolves `actedForRole` to "admin" above and therefore
   * keeps the free field — an admin act is recorded as its own, not as a
   * stand-in for the stage it happened to be sitting on. `rejectAsRole` in
   * `orderPermissions` mirrors this exactly so the dialog agrees.
   */
  const mustPickReason = actedForRole === "technical_manager";

  let reasonId: mongoose.Types.ObjectId | null = null;
  let reasonLabel = "";

  if (body?.reasonId !== undefined && body?.reasonId !== null && body?.reasonId !== "") {
    const rid = oid(body.reasonId);
    if (!rid) return badRequest("Invalid reasonId");
    const picked = (await RejectionReason.findOne({ _id: rid, isActive: true })
      .select("label labelAr")
      .lean()) as { label?: string; labelAr?: string } | null;
    if (!picked) return badRequest("That rejection reason is not in the list");
    reasonId = rid;
    // Arabic first: this is read by Arabic-speaking managers on the order
    // page, the certificate and the report. Denormalized so retiring or
    // rewording the row cannot rewrite why this order was killed.
    reasonLabel = picked.labelAr || picked.label || "";
  } else if (mustPickReason) {
    return badRequest(
      "The Technical Manager must choose a rejection reason from the list."
    );
  }

  /**
   * `reason` stays the single human-readable field every existing reader
   * already prints — the timeline, the notification, the export, the report —
   * so nothing downstream has to learn about `reasonId` to keep working.
   *
   * A reason from the list is stored as its LABEL ALONE. Appending a free note
   * to it would put back exactly what the list removes: the report groups by
   * this text, and "عدم توفر البضاعة — الكمية ناقصة" and "عدم توفر البضاعة"
   * are two rows for one fact. The Technical Manager picks; everybody else
   * writes.
   *
   * Free text sent ALONGSIDE a picked reason is refused rather than dropped —
   * only a stale tab can send it, and silently discarding what somebody typed
   * is worse than telling them it is not accepted here.
   */
  if (reasonLabel && freeText) {
    return badRequest(
      "A rejection chosen from the list carries no note — reload the page and try again."
    );
  }
  const reason = reasonLabel || freeText;

  // A rejection without a stated reason is a dead end nobody can learn from —
  // and it is what the rejection-analysis report reads.
  if (!reason) return badRequest("A reason is required to reject an order");

  const result = await rejectOrder(
    id, shaped,
    { _id: userDoc._id, name: userDoc.name, role: userDoc.role },
    reason, actedForRole,
    { reasonId, reasonLabel }
  );

  if ("code" in result) {
    return conflict("This order has already moved on — reload to see where it is.");
  }

  /**
   * Fan-out is fire-and-forget on purpose. The transition already committed;
   * making the caller wait on a mailing list — or fail because of one — would
   * put a notification ahead of an approval in importance.
   */
  notifyRejected(
    result as unknown as Parameters<typeof notifyRejected>[0],
    userDoc._id
  ).catch((e) => console.error("[reject] notifyRejected:", e));

  return NextResponse.json({ order: result, closed: true });
}
