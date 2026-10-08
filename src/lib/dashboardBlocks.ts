/**
 * Which blocks each role sees, and in what order (SPEC §10.0).
 *
 * Pure data, no DB and no React, so the API decides the layout and the page
 * renders what it is handed. Nine roles with different jobs cannot share one
 * fixed screen, and a client-side `if (role === …)` ladder would be a second
 * copy of this table free to drift from the server's.
 */
export type BlockKey =
  | "waitingOnMe"     // A
  | "myOrders"        // B
  // C — the pipeline board — was dropped from the dashboard outright, its
  // own widget removed rather than relocated; nothing computes it any more.
  | "stuck"           // D — overdue orders; its card lives inside `StatsRow`
  | "thisMonth"       // E
  | "labQueue"        // G
  | "quality"         // H
  | "readyToWeigh"    // I
  | "coverage"        // J — delegations & absence
  // K — "Volume & rejection rate" was removed outright 2026-10-07 (client
  // request), not relocated — see the ROW1 comment in dashboard/page.tsx.
  | "qualityTrend"    // L — in-spec % by month (line)
  | "productMix"      // M — tonnage share by product, last 12 months (donut)
  | "ordersByCity"    // N — posted orders per city, count + tonnage (bars)
  | "ordersByMonth"   // N2 — tonnage posted per month (bars), beside N
  | "tonsByCity";     // O — share of tonnage sold per city (donut)

export const ROLE_BLOCKS: Record<string, BlockKey[]> = {
  sales_coordinator: ["myOrders", "waitingOnMe", "coverage"],
  sales_manager:     ["waitingOnMe", "thisMonth", "myOrders", "ordersByCity", "ordersByMonth", "tonsByCity", "coverage"],
  finance_manager:   ["waitingOnMe", "thisMonth", "coverage"],
  accountant:        ["waitingOnMe", "coverage"],
  // "rejections" ("Where orders die") was dropped from the dashboard on the
  // client's request, and the standalone Rejections page it linked to was
  // removed along with it. The per-stage breakdown now lives on the
  // Rejections report (Reports → Rejections) instead — see that report for
  // the reasoning; it answers the same question the dashboard used to.
  //
  // K/L/M are the year-long trend charts — the daily "what's waiting"
  // blocks above them answer today's question, these answer "is the plant
  // doing better or worse than it was". GM/admin only: they're the roles
  // whose visibility spans every order, so a monthly total means what it
  // says rather than being a fragment of one.
  general_manager:   ["stuck", "waitingOnMe", "thisMonth", "quality", "qualityTrend", "productMix", "ordersByCity", "ordersByMonth", "tonsByCity", "coverage"],
  technical_manager: ["waitingOnMe", "labQueue", "quality", "qualityTrend", "coverage"],
  lab_technician:    ["labQueue", "quality", "coverage"],
  weighbridge:       ["readyToWeigh", "coverage"],
  admin:             ["stuck", "thisMonth", "qualityTrend", "productMix", "ordersByCity", "ordersByMonth", "tonsByCity", "coverage"],
};

/** A role outside the chain still gets a page, not a crash. */
export function blocksFor(role: string): BlockKey[] {
  return ROLE_BLOCKS[role] ?? ["coverage"];
}

/**
 * The line past which an order counts as held up.
 * Re-exported from `aging.ts`, which is the single definition — see the map of
 * every screen it affects in that file's header.
 */
export { LATE_HOURS as STUCK_HOURS } from "@/lib/aging";
