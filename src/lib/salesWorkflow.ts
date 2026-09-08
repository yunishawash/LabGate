/**
 * A Mongo filter, structurally.
 *
 * ⚠️ THIS FILE MUST NOT IMPORT MONGOOSE — not for a type, not for
 * `Types.ObjectId`. Client components import the stage table and the
 * predicates, and one such import drags the whole driver into the browser
 * bundle, failing the build with `Can't resolve 'async_hooks'`.
 *
 * Not a theoretical rule: it happened here, on the customer profile page, in
 * the file whose header already said "no DB imports".
 *
 * Ids therefore stay STRINGS. They are cast by schema path when the filter
 * reaches a query, so nothing is lost by not building an ObjectId.
 */
export type Filter = Record<string, unknown> & {
  $or?: Filter[];
  $and?: Filter[];
  $nor?: Filter[];
};

/**
 * The approval chain, as data.
 *
 * Pure functions only — NO model or database imports — so this file is safe to
 * import from both API routes and client components. Same rule `labQc.ts`
 * states in its header, for the same reason: the UI must reason about authority
 * with exactly the code the server enforces it with.
 */

export type SalesRole =
  | "sales_coordinator"
  | "sales_manager"
  | "finance_manager"
  | "accountant"
  | "general_manager"
  | "technical_manager"
  | "lab_technician"
  | "weighbridge";

export type StageKey =
  | "created"
  | "sales_manager_approval"
  | "finance_manager_approval"
  | "general_manager_approval"
  | "technical_manager_approval"
  | "lab_results"
  | "lab_signoff_gm"
  | "lab_signoff_tm"
  | "weighbridge_post";

export type StageKind = "create" | "approval" | "data_entry" | "weigh";

export type StepStatus = "pending" | "approved" | "completed" | "rejected" | "skipped";
export type OrderStatus = "Pending" | "Posted" | "Rejected";

export interface StageDef {
  key: StageKey;
  /** 1..8 — the number a person sees. Stage 7 is held by TWO stages. */
  index: number;
  role: SalesRole;
  /** May act ONLY while every holder of `role` is absent. Undefined = no
   *  automatic fallback; named delegation still works. */
  deputyRole?: SalesRole;
  kind: StageKind;
  en: string;
  ar: string;
  /** Set only where an index holds more than one stage. "GM sign-off" names a
   *  signature, not the stage the order is sitting at — a screen showing both
   *  signatories under that heading is naming the part for the whole. */
  groupEn?: string;
  groupAr?: string;
}

/**
 * THE declaration. Everything else in this file is derived from it — add a
 * stage here and the visibility floors, the predicates and the UI follow.
 */
export const SALES_STAGES: readonly StageDef[] = [
  { key: "created",                    index: 1, role: "sales_coordinator", deputyRole: "sales_manager",     kind: "create",     en: "Order created",      ar: "إنشاء الطلب" },
  { key: "sales_manager_approval",     index: 2, role: "sales_manager",     deputyRole: "sales_coordinator", kind: "approval",   en: "Sales Manager",      ar: "مدير المبيعات" },
  { key: "finance_manager_approval",   index: 3, role: "finance_manager",   deputyRole: "accountant",        kind: "approval",   en: "Finance Manager",    ar: "المدير المالي" },
  { key: "general_manager_approval",   index: 4, role: "general_manager",   deputyRole: "finance_manager",   kind: "approval",   en: "General Manager",    ar: "المدير العام" },
  // Stages 5, 7 and 8 have NO automatic deputy — a client decision, not an
  // omission. An absent technical manager stalls the order, and that stall must
  // be made visible rather than silent (SPEC §8.2).
  { key: "technical_manager_approval", index: 5, role: "technical_manager",                                  kind: "approval",   en: "Technical Manager",  ar: "المدير التقني" },
  { key: "lab_results",                index: 6, role: "lab_technician",                                     kind: "data_entry", en: "Lab results",        ar: "نتائج المختبر" },
  { key: "lab_signoff_gm",             index: 7, role: "general_manager",                                    kind: "approval",   en: "GM sign-off",        groupEn: "Lab results sign-off", groupAr: "اعتماد نتائج المختبر",        ar: "اعتماد المدير العام" },
  { key: "lab_signoff_tm",             index: 7, role: "technical_manager",                                  kind: "approval",   en: "Tech. sign-off",     groupEn: "Lab results sign-off", groupAr: "اعتماد نتائج المختبر",     ar: "اعتماد المدير التقني" },
  { key: "weighbridge_post",           index: 8, role: "weighbridge",                                        kind: "weigh",      en: "Weighbridge & post", ar: "الميزان والترحيل" },
] as const;

export const FIRST_STAGE = 1;
export const FINAL_STAGE = 8;

const BY_KEY = new Map<string, StageDef>(SALES_STAGES.map((s) => [s.key, s]));

/**
 * Earliest stage each role participates in — this IS the visibility floor.
 *
 * Derived over BOTH `role` and `deputyRole`: a deputy who cannot see an order
 * cannot stand in for anyone. Never hand-maintained.
 */
export const MIN_STAGE_BY_ROLE: Record<string, number> = SALES_STAGES.reduce<
  Record<string, number>
>((acc, s) => {
  for (const r of [s.role, s.deputyRole]) {
    if (!r) continue;
    acc[r] = acc[r] === undefined ? s.index : Math.min(acc[r], s.index);
  }
  return acc;
}, {});

/** The only two hand-written exceptions to "you see it once it reaches you". */
const ROLE_FLAGS: Partial<Record<SalesRole, { seesAll?: boolean; ownOnly?: boolean }>> = {
  // Client rule: the GM sees every order from the moment it is created.
  general_manager: { seesAll: true },
  // Creators see their own orders, not each other's. A flag rather than an `if`
  // in the query builder, because this is the one the client may reverse.
  sales_coordinator: { ownOnly: true },
};

// ── shapes the pure functions work on ────────────────────────────────────────

export interface StepLike {
  stageKey: string;
  stageIndex: number;
  role: string;
  kind: string;
  status: string;
}

export interface OrderLike {
  status: string;
  currentStageIndex: number;
  createdById: string;
  steps: StepLike[];
}

export interface Actor {
  id: string;
  role: string;
}

// ── derived lookups ──────────────────────────────────────────────────────────

export const stageByKey = (k: string): StageDef | null => BY_KEY.get(k) ?? null;
export const stagesAt = (i: number): StageDef[] => SALES_STAGES.filter((s) => s.index === i);
export const nextStageIndex = (i: number): number | null => (i >= FINAL_STAGE ? null : i + 1);
export const isTerminal = (status: string): boolean => status === "Posted" || status === "Rejected";
export const isChainRole = (role: string): role is SalesRole =>
  MIN_STAGE_BY_ROLE[role] !== undefined;

/** 24 hex characters — replaces `Types.ObjectId.isValid` so this file needs no
 *  database import. See the rule at the top. */
export const isObjectIdString = (v: string): boolean => /^[a-f\d]{24}$/i.test(v);

/**
 * Is stage `i` fully satisfied?
 *
 * This is where the dual sign-off falls out for free: stage 7 has two steps, so
 * "every step at this index is done" needs both. No special case anywhere.
 */
export function stageComplete(order: OrderLike, i: number): boolean {
  const steps = order.steps.filter((s) => s.stageIndex === i);
  return steps.length > 0 && steps.every((s) => s.status === "approved" || s.status === "completed");
}

/**
 * Which slots this actor can act on RIGHT NOW, ignoring deputy/delegate
 * authority (that needs database facts — see `authorityFor`). Empty = read-only.
 */
export function actableStages(order: OrderLike, actor: Actor): StageDef[] {
  if (isTerminal(order.status)) return [];
  const isAdmin = actor.role === "admin";
  return stagesAt(order.currentStageIndex).filter((s) => {
    if (!isAdmin && s.role !== actor.role) return false;
    return order.steps.find((st) => st.stageKey === s.key)?.status === "pending";
  });
}

/**
 * The GM (and admin) may kill a live order at ANY stage — the client's rule.
 * Everyone else only on an approval slot that is currently theirs.
 */
export function canReject(order: OrderLike, actor: Actor): boolean {
  if (isTerminal(order.status)) return false;
  if (actor.role === "admin" || actor.role === "general_manager") return true;
  return actableStages(order, actor).some((s) => s.kind === "approval");
}

export function canCreate(actor: Actor): boolean {
  return (
    actor.role === "admin" ||
    actor.role === "sales_coordinator" ||
    // Client rule 1: the sales manager may also raise an order, or appoint
    // someone in his place.
    actor.role === "sales_manager"
  );
}

/**
 * Editing stops at the first approval. Anything looser lets a coordinator
 * change quantities AFTER finance signed off — the exact thing this system
 * exists to prevent.
 */
export function canEdit(order: OrderLike, actor: Actor): boolean {
  if (isTerminal(order.status)) return false;
  if (order.currentStageIndex > 2) return false;
  return actor.role === "admin" || order.createdById === actor.id;
}

// ── authority: primary · delegate · deputy ───────────────────────────────────

export type ActorAuthority =
  | { kind: "primary" }
  | { kind: "admin" }
  | { kind: "delegate"; forRole: SalesRole }
  | { kind: "deputy"; forRole: SalesRole }
  | null;

/**
 * Three ways to gain the right to act on a stage, checked in this order.
 * Pure: the caller supplies the two database facts.
 *
 *   liveDelegationRoles — roles this actor currently holds by delegation
 *   primaryRoleIsAbsent — true when NO active, present user holds stage.role
 */
export function authorityFor(
  stage: StageDef,
  actor: Actor,
  ctx: { liveDelegationRoles?: string[]; primaryRoleIsAbsent?: boolean }
): ActorAuthority {
  if (actor.role === "admin") return { kind: "admin" };
  if (actor.role === stage.role) return { kind: "primary" };

  // Deliberate hand-over by the primary: works whether or not they are away.
  if (ctx.liveDelegationRoles?.includes(stage.role)) {
    return { kind: "delegate", forRole: stage.role };
  }

  // The written-in fallback. A deputy is NOT a second approver — it only opens
  // when nobody who owns the stage is present.
  if (stage.deputyRole && actor.role === stage.deputyRole && ctx.primaryRoleIsAbsent) {
    return { kind: "deputy", forRole: stage.role };
  }

  return null;
}

/**
 * Every role this actor can act as right now — their own plus anything held by
 * a live delegation. Drives both authority and visibility, so the two can never
 * disagree.
 */
export function effectiveRoles(actor: Actor, liveDelegationRoles: string[] = []): string[] {
  return Array.from(new Set([actor.role, ...liveDelegationRoles]));
}

// ── visibility ───────────────────────────────────────────────────────────────

/**
 * A filter yielding EXACTLY the orders `actor` may read.
 *
 * The rule collapses to one indexed range comparison because
 * `currentStageIndex` is MONOTONIC — rejection is terminal, so an order never
 * moves backwards:
 *
 *     a role sees an order iff the order has reached the earliest stage that
 *     role owns.
 *
 * NEVER filter visibility in JS after fetching: pagination totals would lie,
 * and a detail route would leak the existence of orders it then refuses.
 */
export function visibilityFilter(
  actor: Actor,
  liveDelegationRoles: string[] = []
): Filter {
  const base: Filter = { isActive: true };
  if (actor.role === "admin") return base;

  const roles = effectiveRoles(actor, liveDelegationRoles);
  const floors = roles.map((r) => MIN_STAGE_BY_ROLE[r]).filter((n): n is number => n !== undefined);

  const or: Filter[] = [];
  if (isObjectIdString(actor.id)) {
    // Strings, not ObjectIds — see the rule at the top of this file.
    // A creator always sees their own work, whatever their role.
    or.push({ createdById: actor.id });
    // Anyone who ever acted keeps read access — needed for tracking, and it
    // survives a later role change.
    or.push({ "steps.actedById": actor.id });
  }

  if (roles.some((r) => ROLE_FLAGS[r as SalesRole]?.seesAll)) return base;

  const ownOnly = roles.every((r) => ROLE_FLAGS[r as SalesRole]?.ownOnly);
  if (!ownOnly && floors.length) {
    or.push({ currentStageIndex: { $gte: Math.min(...floors) } });
  }

  // A role with no part in the chain and no history sees nothing. An impossible
  // filter rather than an early return, so callers still get a valid query and
  // an empty page with HTTP 200.
  if (!or.length) return { ...base, _id: { $in: [] as string[] } };

  return { ...base, $or: or };
}

/**
 * Combine filter fragments without letting two of them fight over `$or`.
 *
 * `visibilityFilter` returns `$or`, and search filters want `$or` too — the
 * second silently overwrites the first, quietly widening what a user can see.
 * The CMMS hit this and hand-patched it at one call site; a helper makes it
 * impossible to forget at the next one.
 */
export function andFilters(
  ...parts: (Filter | null | undefined)[]
): Filter {
  const flat: Record<string, unknown> = {};
  const and: Filter[] = [];

  for (const part of parts) {
    if (!part) continue;

    // Split each fragment: plain fields hoist to the top level, only the
    // logical operators go into $and. Pushing a whole fragment down would bury
    // `isActive: true` inside $and[0] — still correct, but it costs the planner
    // the obvious index and makes the query far harder to read in a log.
    const ops: Filter = {};
    let hasOps = false;
    for (const [key, value] of Object.entries(part)) {
      if (key === "$or" || key === "$and" || key === "$nor") {
        ops[key] = value as Filter[];
        hasOps = true;
      } else {
        flat[key] = value;
      }
    }
    if (hasOps) and.push(ops);
  }

  // One operator fragment does not need wrapping — merge it straight in.
  if (and.length === 1) return { ...flat, ...and[0] };
  return and.length ? { ...flat, $and: and } : flat;
}
