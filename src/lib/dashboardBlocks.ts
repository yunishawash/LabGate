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
  | "pipeline"        // C
  | "stuck"           // D
  | "thisMonth"       // E
  | "labQueue"        // G
  | "quality"         // H
  | "readyToWeigh"    // I
  | "coverage"        // J — delegations & absence
  | "volumeTrend"     // K — tonnage by month, rejection rate overlaid (bar + line)
  | "qualityTrend"    // L — in-spec % by month (line)
  | "productMix";     // M — tonnage share by product, last 12 months (donut)

export const ROLE_BLOCKS: Record<string, BlockKey[]> = {
  sales_coordinator: ["myOrders", "waitingOnMe", "coverage"],
  sales_manager:     ["waitingOnMe", "thisMonth", "myOrders", "coverage"],
  finance_manager:   ["waitingOnMe", "thisMonth", "coverage"],
  accountant:        ["waitingOnMe", "coverage"],
  // "rejections" ("Where orders die") was dropped from the dashboard on the
  // client's request, then removed outright along with the standalone
  // Rejections page it linked to. The full breakdown, with the rejection
  // rate per stage, still lives on the Rejections report (Reports →
  // Rejections), where it's read weekly.
  //
  // K/L/M are the year-long trend charts — the daily "what's waiting"
  // blocks above them answer today's question, these answer "is the plant
  // doing better or worse than it was". GM/admin only: they're the roles
  // whose visibility spans every order, so a monthly total means what it
  // says rather than being a fragment of one.
  general_manager:   ["stuck", "pipeline", "waitingOnMe", "thisMonth", "quality", "volumeTrend", "qualityTrend", "productMix", "coverage"],
  technical_manager: ["waitingOnMe", "labQueue", "quality", "qualityTrend", "coverage"],
  lab_technician:    ["labQueue", "quality", "coverage"],
  weighbridge:       ["readyToWeigh", "coverage"],
  admin:             ["stuck", "pipeline", "thisMonth", "volumeTrend", "qualityTrend", "productMix", "coverage"],
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
