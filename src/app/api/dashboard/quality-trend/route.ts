import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, dateRange, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import LabCustomer from "@/models/LabCustomer";
import LabParameter from "@/models/LabParameter";

/**
 * Quality-over-time, for ONE parameter — "W" (الطاقة, 10e-4J) today — rather
 * than a sample's overall pass/fail.
 *
 * Split out of the main `/api/dashboard` payload (2026-10-08, client
 * request) because this card owns its OWN product selector, inside its own
 * card, independent of the page's top filter bar — the top product filter
 * answers "what does the catalogue look like", this one asks "how has this
 * one grade's energy reading moved", and the two must not fight over the
 * same query param. A dedicated route lets the card re-fetch on its own
 * selector without re-running every other dashboard block.
 *
 * Still takes the page's own date range and customer/city scope — those are
 * "which orders count at all", not "which parameter" — so the card still
 * moves with the rest of the dashboard when the client narrows to a date
 * range or a city, just never to a product.
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  const range = dateRange(searchParams.get("from"), searchParams.get("to"));

  const productId = searchParams.get("productId");
  let productOid = null;
  if (productId) {
    productOid = oid(productId);
    if (!productOid) return badRequest("Invalid productId");
  }

  const customerId = searchParams.get("customerId");
  let customerOid = null;
  if (customerId) {
    customerOid = oid(customerId);
    if (!customerOid) return badRequest("Invalid customerId");
  }

  const cityId = searchParams.get("cityId");
  let cityOid = null;
  if (cityId) {
    cityOid = oid(cityId);
    if (!cityOid) return badRequest("Invalid cityId");
  }

  // See the identical pattern (and its reasoning) in the main dashboard
  // route — a city isn't a field on the sample, it's resolved to the
  // customers in it. A specific customer wins over a city, same as there.
  const scope: Record<string, unknown> = {};
  if (customerOid) {
    scope.customerId = customerOid;
  } else if (cityOid) {
    const ids = await LabCustomer.find({ cityId: cityOid }).distinct("_id");
    scope.customerId = { $in: ids.length ? ids : [null] };
  }

  const w = await LabParameter.findOne({ name: "W" }).select("_id").lean();
  if (!w) {
    // The parameter isn't configured yet — an empty trend, not an error, so
    // the card renders its own "not configured" state rather than crashing.
    return NextResponse.json({ rows: [] });
  }

  const now = new Date();
  const windowEnd = range?.$lte ?? now;
  const windowStart = range?.$gte ?? new Date(windowEnd.getFullYear(), windowEnd.getMonth() - 11, 1);

  const match: Record<string, unknown> = {
    isActive: true,
    sampleDate: { $gte: windowStart, $lte: windowEnd },
    "results.parameterId": (w as { _id: unknown })._id,
    ...scope,
  };
  if (productOid) match.productId = productOid;

  const rows = await LabSample.aggregate([
    { $match: match },
    { $unwind: "$results" },
    { $match: { "results.parameterId": (w as { _id: unknown })._id } },
    {
      $group: {
        _id: { y: { $year: "$sampleDate" }, m: { $month: "$sampleDate" }, status: "$results.status" },
        n: { $sum: 1 },
      },
    },
  ]);

  const byKey = new Map<string, { pass: number; warning: number; fail: number }>();
  for (const r of rows) {
    const key = `${r._id.y}-${r._id.m}`;
    const cur = byKey.get(key) ?? { pass: 0, warning: 0, fail: 0 };
    cur[r._id.status as "pass" | "warning" | "fail"] = r.n;
    byKey.set(key, cur);
  }

  const slots: { year: number; month: number }[] = [];
  const cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  const last = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
  while (cursor <= last) {
    slots.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const out = slots.map(({ year, month }) => {
    const c = byKey.get(`${year}-${month + 1}`);
    const total = c ? c.pass + c.warning + c.fail : 0;
    return {
      year, month, samples: total,
      inSpecPct: total ? Math.round(((c!.pass + c!.warning) / total) * 1000) / 10 : null,
    };
  });

  return NextResponse.json({ rows: out });
}
