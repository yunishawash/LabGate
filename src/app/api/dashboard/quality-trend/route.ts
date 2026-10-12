import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, dateRange, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import LabCustomer from "@/models/LabCustomer";
import LabParameter from "@/models/LabParameter";
import LabProduct from "@/models/LabProduct";

/**
 * Quality-over-time, for ONE lab-tested grade (or all of them) and ONE lab
 * parameter (client request, 2026-10-12 — widened from the original,
 * "W"-only build of 2026-10-08, then widened again the same day from
 * "flour only" to every type that actually goes through the lab).
 *
 * Split out of the main `/api/dashboard` payload because this card owns its
 * OWN product AND parameter selectors, inside its own card, independent of
 * the page's top filter bar — the top product filter answers "what does the
 * catalogue look like", this card asks "how has this one grade's chosen test
 * moved", and the two must not fight over the same query param. A dedicated
 * route lets the card re-fetch on its own selectors without re-running every
 * other dashboard block.
 *
 * Still takes the page's own date range and customer/city scope — those are
 * "which orders count at all", not "which grade or test" — so the card still
 * moves with the rest of the dashboard when the client narrows to a date
 * range or a city, just never to a product.
 *
 * Scoped to lab-tested types, not the whole catalogue: this card asks "is
 * what the lab actually tests in spec", and a type whose orders skip the lab
 * (`orderRequiresLabTest: false`) has no business on a quality chart. Not
 * hardcoded to "Flour" — any type flagged lab-tested qualifies, including one
 * added after this card was built, and including a type that is itself the
 * sampled unit (no grades under it, like a raw-material intake type) rather
 * than only types with grades.
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

  const parameterId = searchParams.get("parameterId");
  let parameterOid = null;
  if (parameterId) {
    parameterOid = oid(parameterId);
    if (!parameterOid) return badRequest("Invalid parameterId");
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

  /**
   * Every orderable grade under a lab-tested TYPE — i.e. the same set the
   * in-card picker offers (see `labTestedOptions` in charts.tsx). A chosen
   * `productOid` is trusted to BE one of these without re-checking
   * membership — the picker only ever offers this set to begin with, so a
   * mismatched id here would have to be typed by hand against the API
   * directly, which an empty result answers well enough.
   *
   * "Orderable" mirrors `isOrderableProduct` (types/index.ts): a grade, or a
   * TYPE that has no grades of its own and so is the sampled unit directly
   * (e.g. a raw-material intake type with nothing under it).
   */
  let productMatch: Record<string, unknown>;
  if (productOid) {
    productMatch = { productId: productOid };
  } else {
    const all = await LabProduct.find({ isActive: true })
      .select("_id parentId orderRequiresLabTest").lean();
    const childCount = new Map<string, number>();
    for (const p of all) {
      if (p.parentId) childCount.set(String(p.parentId), (childCount.get(String(p.parentId)) ?? 0) + 1);
    }
    const labTestedTypeIds = new Set(
      all.filter((p) => !p.parentId && p.orderRequiresLabTest !== false).map((p) => String(p._id))
    );
    const gradeIds = all
      .filter((p) =>
        p.parentId
          ? labTestedTypeIds.has(String(p.parentId))
          : labTestedTypeIds.has(String(p._id)) && !childCount.get(String(p._id))
      )
      .map((p) => p._id);
    // No lab-tested type configured yet: an empty trend, not every product
    // in the system standing in for it.
    productMatch = { productId: { $in: gradeIds.length ? gradeIds : [null] } };
  }

  const param = parameterOid
    ? await LabParameter.findOne({ _id: parameterOid }).select("_id").lean()
    : await LabParameter.findOne({ name: "W" }).select("_id").lean();
  if (!param) {
    // No such parameter (or "W" isn't configured yet, on first load with no
    // explicit choice): an empty trend, not an error, so the card renders
    // its own "not configured" state rather than crashing.
    return NextResponse.json({ rows: [] });
  }
  const paramId = (param as { _id: unknown })._id;

  const now = new Date();
  const windowEnd = range?.$lte ?? now;
  const windowStart = range?.$gte ?? new Date(windowEnd.getFullYear(), windowEnd.getMonth() - 11, 1);

  const match: Record<string, unknown> = {
    isActive: true,
    sampleDate: { $gte: windowStart, $lte: windowEnd },
    "results.parameterId": paramId,
    ...scope,
    ...productMatch,
  };

  const rows = await LabSample.aggregate([
    { $match: match },
    { $unwind: "$results" },
    { $match: { "results.parameterId": paramId } },
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

  // `parameterId` echoed back so the card can sync its own selector on first
  // load, when the client sent none and the server fell back to "W".
  return NextResponse.json({ rows: out, parameterId: String(paramId) });
}
