/**
 * How long an order may sit at one desk before the screen says so.
 *
 * ONE definition, because there were five: a constant in `dashboardBlocks.ts`
 * and `48 * 3600_000` written by hand in the aging colours, the pipeline board
 * and the health page. Changing the number in one place left the others
 * disagreeing, and the disagreement is invisible — a row can be amber on the
 * dashboard and slate on the list with nothing to indicate which is right.
 *
 * ── Where these show, so the effect can be seen ──────────────────────────
 *
 *  WARN_HOURS (24h) — amber:
 *    · Orders Overview → "Current stage" cell, the clock beside the wait
 *    · Dashboard → "Waiting on you", the clock on each row
 *    · Approvals and Results Sign-off → the clock on each row
 *
 *  LATE_HOURS (48h) — red, and this is the one that changes behaviour:
 *    · everything above, in red instead of amber
 *    · Dashboard → the "N orders waiting more than 2 days" alert strip, which
 *      is ABSENT entirely below the threshold (GM and admin)
 *    · Dashboard → "The whole chain", a stage bar turns red
 *    · System Health → the "Waiting over 2 days" count
 *    · Reports → nothing; the reports state real durations rather than judging
 *      them, which is why the threshold is a display rule and not a data one.
 *
 * To change it, change it here. Nothing else needs editing.
 */

/** Amber past this. Long enough to be worth noticing, short enough to act on. */
export const WARN_HOURS = 24;

/**
 * Red past this — the client's own working assumption, and the one number a
 * manager will want to argue about. Two working days is the point at which a
 * held order stops being "busy" and starts being "forgotten".
 */
export const LATE_HOURS = 48;

export const WARN_MS = WARN_HOURS * 3_600_000;
export const LATE_MS = LATE_HOURS * 3_600_000;

export type AgingTone = "calm" | "warn" | "late";

/** Pure, and takes `now` rather than reading the clock — see `useNow`. */
export function agingToneFrom(enteredAt: string | Date, now: number): AgingTone {
  const ms = now - new Date(enteredAt).getTime();
  if (ms > LATE_MS) return "late";
  if (ms > WARN_MS) return "warn";
  return "calm";
}
