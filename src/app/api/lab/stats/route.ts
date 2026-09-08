import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import { stdDev, coefficientOfVariation, rate } from "@/lib/labQc";

/**
 * QC KPI roll-up per product × parameter — consistency (% in-spec) and
 * variability (CV%), the two metrics the QA workbook's KPI_Dashboard tracks.
 *
 * Accepts the same filters as the samples list (product / customer / date
 * range / shift), so the very same dashboard answers "how is Product X
 * doing?" and "what did we ship Customer Y over this period?".
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);

  const match: Record<string, unknown> = { isActive: true };

  const productId = searchParams.get("product");
  // Validated, not cast blindly: the CMMS threw a 500 on any malformed id.
  if (productId && productId !== "all") {
    const id = oid(productId);
    if (!id) return badRequest("Invalid product");
    match.productId = id;
  }

  const customerId = searchParams.get("customer");
  if (customerId && customerId !== "all") {
    const id = oid(customerId);
    if (!id) return badRequest("Invalid customer");
    match.customerId = id;
  }

  const shift = searchParams.get("shift");
  if (shift && shift !== "all") match.shift = shift;

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from || to) {
    const df: Record<string, Date> = {};
    if (from) df.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      df.$lte = end;
    }
    match.sampleDate = df;
  }

  // Pull only what the KPIs need. Stats are computed in JS rather than in
  // the aggregation pipeline because the CV%/rating rules live in
  // src/lib/labQc.ts and must stay identical to the client-side preview.
  const samples = await LabSample.find(match)
    .select("productId product results sampleDate overallStatus")
    .lean();

  type Bucket = {
    productId: string; product: string;
    parameterId: string; parameterName: string; unit: string;
    values: number[]; statuses: string[];
    target: number | null; min: number | null; max: number | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const s of samples) {
    for (const r of s.results ?? []) {
      const key = `${s.productId}|${r.parameterId}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          productId: s.productId.toString(),
          product: s.product,
          parameterId: r.parameterId.toString(),
          parameterName: r.parameterName,
          unit: r.unit,
          values: [], statuses: [],
          // Limits are snapshotted per result; the most recent sample's copy
          // is the best available "current spec" for display on the KPI row.
          target: r.target ?? null, min: r.min ?? null, max: r.max ?? null,
        };
        buckets.set(key, b);
      }
      b.values.push(r.value);
      b.statuses.push(r.status);
    }
  }

  const rows = [...buckets.values()].map((b) => {
    const count = b.values.length;
    const average = b.values.reduce((s, v) => s + v, 0) / count;
    // Warnings are still inside the accepted range, so they count as in-spec;
    // only a true out-of-range result counts against consistency.
    const inSpec = b.statuses.filter((st) => st !== "fail").length;
    const inSpecPct = (inSpec / count) * 100;
    const cvPct = coefficientOfVariation(b.values);

    return {
      productId: b.productId,
      product: b.product,
      parameterId: b.parameterId,
      parameterName: b.parameterName,
      unit: b.unit,
      count,
      average,
      stdDev: stdDev(b.values),
      cvPct,
      minRecorded: Math.min(...b.values),
      maxRecorded: Math.max(...b.values),
      inSpecPct,
      rating: rate(inSpecPct, cvPct),
      target: b.target,
      min: b.min,
      max: b.max,
    };
  });

  rows.sort((a, b) =>
    a.product.localeCompare(b.product) || a.parameterName.localeCompare(b.parameterName)
  );

  const totalSamples = samples.length;
  const failedSamples = samples.filter((s) => s.overallStatus === "fail").length;
  const warningSamples = samples.filter((s) => s.overallStatus === "warning").length;

  return NextResponse.json({
    rows,
    summary: {
      totalSamples,
      failedSamples,
      warningSamples,
      passedSamples: totalSamples - failedSamples - warningSamples,
      sampleInSpecPct: totalSamples > 0 ? ((totalSamples - failedSamples) / totalSamples) * 100 : null,
      avgInSpecPct: rows.length > 0 ? rows.reduce((s, r) => s + r.inSpecPct, 0) / rows.length : null,
      avgCvPct: (() => {
        const cvs = rows.map((r) => r.cvPct).filter((c): c is number => c != null);
        return cvs.length > 0 ? cvs.reduce((s, c) => s + c, 0) / cvs.length : null;
      })(),
      needsAttention: rows.filter((r) => r.rating === "needs_attention").length,
    },
  });
}
