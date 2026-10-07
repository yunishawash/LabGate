import mongoose from "mongoose";
import Delegation from "@/models/Delegation";
import User from "@/models/User";
import { notAbsentFilter } from "@/lib/requireSession";
import {
  SALES_STAGES, actableStages, authorityFor, canReject, canEdit, stagesAt,
  type Actor, type OrderLike, type ActorAuthority, type StageDef,
} from "@/lib/salesWorkflow";

/**
 * The database facts `salesWorkflow`'s pure functions need. Kept here so the
 * engine stays importable from client components.
 */

/** Roles this user currently holds by a live delegation. */
export async function liveDelegationRoles(userId: string, now = new Date()): Promise<string[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return [];
  const rows = (await Delegation.find({
    toUserId: userId,
    isActive: true,
    from: { $lte: now },
    to: { $gte: now },
  })
    .select("role")
    .lean()) as { role: string }[];
  return Array.from(new Set(rows.map((r) => r.role)));
}

/**
 * Is EVERY holder of this role away (or is there none at all)? That is the one
 * condition that opens a deputy slot — a deputy is a fallback, not a second
 * approver.
 */
export async function isRoleUnavailable(role: string, now = new Date()): Promise<boolean> {
  const present = await User.countDocuments({
    role,
    isActive: true,
    ...notAbsentFilter(now),
  });
  return present === 0;
}

export interface OrderPermissions {
  canApprove: boolean;
  canReject: boolean;
  canEnterLab: boolean;
  canWeigh: boolean;
  canEdit: boolean;
  /** Collections/packing notes are role-gated, not stage-gated — neither box
   *  is a chain slot, so this does not come from `granted`. */
  canWriteCollections: boolean;
  canWritePacking: boolean;
  actableStageKeys: string[];
  /** Set when the actor is standing in for someone — the UI must say so before
   *  they sign, and the stored signature records it. */
  actingAs: { kind: string; forRole: string } | null;
  /** Stages held up by an absent primary that has no deputy. Surfacing this is
   *  what keeps a stalled order from stalling silently (SPEC §8.2). */
  stalled: { stageKey: string; role: string } | null;
  /**
   * WHOSE authority a rejection by this actor would be recorded under —
   * `rejectOrder`'s `actedForRole`, computed here so the reject dialog can
   * know whether the managed reason list applies without re-deriving it.
   *
   * The client must not work this out for itself. Whether the Technical
   * Manager's closed vocabulary applies depends on deputy and delegation
   * facts that live in the database, and a second copy of that rule in the
   * browser would be free to drift from the one the route enforces — showing
   * a free-text box to someone the server will then refuse.
   */
  rejectAsRole: string;
}

/**
 * Mirror of the `actedForRole` the reject route derives. Kept beside
 * `orderPermissions` and fed the same `granted` list it already computed, so
 * the two cannot disagree about who a rejection belongs to.
 */
function rejectAsRoleFor(
  actor: Actor,
  granted: { stage: StageDef; authority: Exclude<ActorAuthority, null> }[]
): string {
  // An admin override is recorded as an admin act, not as a stand-in for the
  // role whose stage it happens to be — so the closed list does not bind it.
  if (actor.role === "admin") return "admin";

  // An approval slot of their own at the current stage, held primarily or as a
  // deputy/delegate. `granted` has already resolved which.
  const approval = granted.find((g) => g.stage.kind === "approval");
  if (approval) {
    return "forRole" in approval.authority ? approval.authority.forRole : approval.stage.role;
  }

  // No slot — this is the General Manager's standing power to kill a live
  // order at any stage, exercised in his own name.
  return actor.role;
}

/**
 * What this actor may do to this order, computed server-side from the same
 * functions the transition routes enforce with. The client uses it only to
 * show or hide buttons; every POST re-checks.
 */
export async function orderPermissions(
  order: OrderLike,
  actor: Actor,
  delegatedRoles?: string[]
): Promise<OrderPermissions> {
  const delegations = delegatedRoles ?? (await liveDelegationRoles(actor.id));

  const live = stagesAt(order.currentStageIndex).filter(
    (s) => order.steps.find((st) => st.stageKey === s.key)?.status === "pending"
  );

  // Resolve authority per live slot, gathering the absence facts once each.
  const absenceCache = new Map<string, boolean>();
  const granted: { stage: StageDef; authority: Exclude<ActorAuthority, null> }[] = [];

  for (const stage of live) {
    let absent = absenceCache.get(stage.role);
    if (absent === undefined) {
      absent = stage.deputyRole ? await isRoleUnavailable(stage.role) : false;
      absenceCache.set(stage.role, absent);
    }
    const authority = authorityFor(stage, actor, {
      liveDelegationRoles: delegations,
      primaryRoleIsAbsent: absent,
    });
    if (authority) granted.push({ stage, authority });
  }

  // A stage with no deputy whose primary is away goes nowhere until they return.
  let stalled: OrderPermissions["stalled"] = null;
  for (const stage of live) {
    if (stage.deputyRole) continue;
    if (await isRoleUnavailable(stage.role)) {
      stalled = { stageKey: stage.key, role: stage.role };
      break;
    }
  }

  const standIn = granted.find((g) => g.authority.kind === "deputy" || g.authority.kind === "delegate");

  return {
    canApprove: granted.some((g) => g.stage.kind === "approval"),
    canReject: canReject(order, actor) || granted.some((g) => g.stage.kind === "approval"),
    canEnterLab: granted.some((g) => g.stage.kind === "data_entry"),
    canWeigh: granted.some((g) => g.stage.kind === "weigh"),
    canEdit: canEdit(order, actor),
    canWriteCollections: ["accountant", "finance_manager", "admin"].includes(actor.role),
    canWritePacking: ["weighbridge", "admin"].includes(actor.role),
    actableStageKeys: granted.map((g) => g.stage.key),
    actingAs: standIn
      ? {
          kind: standIn.authority.kind,
          forRole: "forRole" in standIn.authority ? standIn.authority.forRole : "",
        }
      : null,
    stalled,
    rejectAsRole: rejectAsRoleFor(actor, granted),
  };
}

/** Every stage this actor could ever act on — drives the "waiting on me" queue. */
export function stagesOwnedBy(role: string, delegatedRoles: string[] = []): StageDef[] {
  const roles = new Set([role, ...delegatedRoles]);
  return SALES_STAGES.filter((s) => roles.has(s.role) || (s.deputyRole && roles.has(s.deputyRole)));
}

export { actableStages };
