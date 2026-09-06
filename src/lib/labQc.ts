/**
 * Shared QC scoring rules — the single source of truth for how a measured
 * value is judged. Pure functions only (no DB/model imports) so this file is
 * safe to import from BOTH server routes and client components; that's why
 * threshold *resolution* (which needs Mongo) lives separately in
 * src/lib/labThreshold.ts.
 *
 * Method adopted from the QA department's lab_rules.xlsx workbook:
 *   OK       — comfortably inside the accepted range
 *   WARNING  — still inside, but within 15% of the range width from an edge
 *   FAIL     — outside the accepted Min/Max
 * The 15%-of-range-width band was verified to reproduce that workbook's
 * Status column exactly.
 */

export type LabOperator = "n_m_t" | "n_l_t" | "range" | "none";
export type LabStatus = "pass" | "warning" | "fail";

/** Share of the range width, measured in from each edge, that counts as
 * "close to a limit". From the workbook's colour legend. */
export const WARNING_BAND_RATIO = 0.15;

/**
 * Width of the "close to the limit" band in the value's own units.
 * - Both bounds known → 15% of the range width (the workbook's rule).
 * - Only one bound + a target → 15% of the distance between them, so
 *   one-sided specs (the QA PDF's N.M.T / N.L.T limits) still get a
 *   proportional warning zone.
 * - Otherwise there is no natural scale, so no warning zone exists.
 */
export function warningBand(
  min: number | null,
  max: number | null,
  target?: number | null
): number | null {
  if (min != null && max != null) return (max - min) * WARNING_BAND_RATIO;
  if (target != null && max != null) return Math.abs(max - target) * WARNING_BAND_RATIO;
  if (target != null && min != null) return Math.abs(target - min) * WARNING_BAND_RATIO;
  return null;
}

/**
 * Score one measured value against its resolved limits.
 *   n_m_t  = "not more than" → fails above max
 *   n_l_t  = "not less than" → fails below min
 *   range  = fails outside [min, max]
 *   none   = informational only (e.g. Color L*) — always passes
 */
export function evaluate(
  value: number,
  min: number | null,
  max: number | null,
  operator: LabOperator,
  target?: number | null
): LabStatus {
  if (operator === "none") return "pass";

  const checksMax = operator === "n_m_t" || operator === "range";
  const checksMin = operator === "n_l_t" || operator === "range";

  // Hard limits first — being out of range always wins over "near a limit".
  if (checksMax && max != null && value > max) return "fail";
  if (checksMin && min != null && value < min) return "fail";

  const band = warningBand(min, max, target);
  if (band != null && band > 0) {
    if (checksMax && max != null && max - value <= band) return "warning";
    if (checksMin && min != null && value - min <= band) return "warning";
  }

  return "pass";
}

/** Signed relative deviation from the recommended value, e.g. 0.05 = 5% high.
 * Null when there's no target to compare against. */
export function deviationFromTarget(
  value: number,
  target: number | null | undefined
): number | null {
  if (target == null || target === 0) return null;
  return (value - target) / target;
}

/** A sample is only as good as its worst line: any fail → fail, else any
 * warning → warning, else pass. */
export function rollUpStatus(statuses: LabStatus[]): LabStatus {
  if (statuses.some((s) => s === "fail")) return "fail";
  if (statuses.some((s) => s === "warning")) return "warning";
  return "pass";
}

// ── KPI helpers (KPI_Dashboard sheet) ───────────────────────────────────────

/** Sample standard deviation (n-1). Returns null for fewer than 2 points.
 * NOTE: the source workbook's StdDev column is miscalculated for several
 * rows (it reports values larger than the data's own spread, yielding CV%
 * over 100%); this computes it correctly instead of reproducing that bug. */
export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation as a percentage — the workbook's variability
 * metric. Lower = more consistent process. */
export function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const sd = stdDev(values);
  return sd == null ? null : (sd / Math.abs(mean)) * 100;
}

export type QcRating = "excellent" | "good" | "needs_attention";

/**
 * Combined consistency + variability verdict, from the workbook's colour
 * legend (% In-Spec: >=95 green / 85-95 yellow / <85 red;
 * CV%: <5 green / 5-10 yellow / >10 red).
 */
export function rate(inSpecPct: number, cvPct: number | null): QcRating {
  if (inSpecPct >= 95 && (cvPct == null || cvPct < 5)) return "excellent";
  if (inSpecPct >= 85 && (cvPct == null || cvPct <= 10)) return "good";
  return "needs_attention";
}
