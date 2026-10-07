import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, dateRange, oneOf } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { multiSelectFilters, lineLabStatuses } from "@/lib/reportHelpers";
import SalesOrder from "@/models/SalesOrder";

const REPORTS = ["variance", "customers", "weightTrend", "weightTrendOrders", "orders"] as const;
export type ReportKey = (typeof REPORTS)[number];

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * The weekly, managerial reports — read by one person on a Sunday, not by eight
 * people every morning. Every `$match` opens with `visibilityFilter`, exactly
 * like the list and the dashboard: a report is just another read path.
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);
  const visible = visibilityFilter(actor, delegated);

  const { searchParams } = new URL(req.url);
  const report = oneOf(searchParams.get("report"), REPORTS, "variance") as ReportKey;
  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  const dated = (field: string) => (range ? { [field]: range } : {});

  // ── Are we shipping what we sold ─────────────────────────────────────────
  if (report === "variance") {
    const { customerFilter, productFilter } = multiSelectFilters(searchParams);
    const match = andFilters(visible, { status: "Posted" }, dated("postedAt"), customerFilter, productFilter);
    const [byCustomer, outliers, overall] = await Promise.all([
      SalesOrder.aggregate([
        { $match: match },
        {
          // Group by id ALONE. `customer`/`customerAr` are denormalized onto
          // each order at creation time (SalesOrder.ts's own comment on why:
          // a later rename must not rewrite an already-approved paper trail),
          // so the same customer can carry two different spellings across
          // orders — an empty `customerAr` on some orders and the real name
          // on others is the common case, and it is NOT reliably the older
          // orders that are missing it (a customer created via a path that
          // skipped the Arabic name can still be recent). A compound `_id`
          // of {id, name, nameAr} split that one customer into two rows
          // sharing a `customerId` — a wrong total (split across rows
          // instead of summed) and a React key collision downstream. `$max`
          // reliably prefers any non-empty string over "" regardless of
          // which order carries it, without needing to guess by recency.
          $group: {
            _id: "$customerId",
            name: { $max: "$customer" },
            nameAr: { $max: "$customerAr" },
            orders: { $sum: 1 },
            orderedKg: { $sum: "$totalWeightKg" },
            actualKg: { $sum: "$actualNetWeightKg" },
            avgPct: { $avg: "$variancePct" },
          },
        },
        { $sort: { orderedKg: -1 } },
        { $limit: 50 },
      ]),
      // Past ±1% somebody should look at the individual load, not the average:
      // two loads 3% apart in opposite directions average to nothing at all.
      SalesOrder.find(
        andFilters(match, { $or: [{ variancePct: { $gt: 1 } }, { variancePct: { $lt: -1 } }] })
      )
        .sort({ postedAt: -1 })
        .limit(50)
        .select("orderNumber customer customerAr totalWeightKg actualNetWeightKg varianceKg variancePct postedAt")
        .lean(),
      SalesOrder.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            orderedKg: { $sum: "$totalWeightKg" },
            actualKg: { $sum: "$actualNetWeightKg" },
          },
        },
      ]),
    ]);

    return NextResponse.json({
      report,
      byCustomer: byCustomer.map((c) => ({
        customerId: String(c._id ?? ""),
        name: c.name as string,
        nameAr: (c.nameAr as string) ?? "",
        orders: c.orders as number,
        orderedKg: c.orderedKg as number,
        actualKg: c.actualKg as number,
        avgPct: round1(c.avgPct as number),
      })),
      outliers,
      overall: overall[0] ?? null,
    });
  }

  // ── Who our real customers are ───────────────────────────────────────────
  if (report === "customers") {
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, dated("createdAt")) },
      {
        // See the identical fix (and its comment) on the variance report's
        // `byCustomer` grouping above — same denormalized-name-drift bug.
        $group: {
          _id: "$customerId",
          name: { $max: "$customer" },
          nameAr: { $max: "$customerAr" },
          orders: { $sum: 1 },
          orderedKg: { $sum: "$totalWeightKg" },
          posted: { $sum: { $cond: [{ $eq: ["$status", "Posted"] }, 1, 0] } },
          postedKg: { $sum: { $cond: [{ $eq: ["$status", "Posted"] }, "$totalWeightKg", 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "Rejected"] }, 1, 0] } },
          rejectedKg: { $sum: { $cond: [{ $eq: ["$status", "Rejected"] }, "$totalWeightKg", 0] } },
          // Only posted orders have a cycle; $cond keeps the pending ones from
          // being averaged in as zeros.
          cycleHours: {
            $push: {
              $cond: [
                { $eq: ["$status", "Posted"] },
                { $divide: [{ $subtract: ["$postedAt", "$createdAt"] }, 3600000] },
                "$$REMOVE",
              ],
            },
          },
          fails: { $sum: { $cond: [{ $eq: ["$labOverallStatus", "fail"] }, 1, 0] } },
        },
      },
      { $sort: { orderedKg: -1 } },
      { $limit: 100 },
    ]);

    return NextResponse.json({
      report,
      rows: rows.map((r) => {
        const hours = (r.cycleHours as number[]).filter((h) => Number.isFinite(h));
        return {
          customerId: String(r._id ?? ""),
          name: r.name as string,
          nameAr: (r.nameAr as string) ?? "",
          orders: r.orders as number,
          orderedKg: r.orderedKg as number,
          posted: r.posted as number,
          postedKg: r.postedKg as number,
          rejected: r.rejected as number,
          rejectedKg: r.rejectedKg as number,
          rejectionPct: r.orders ? Math.round((r.rejected / r.orders) * 1000) / 10 : 0,
          avgCycleHours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
          labFails: r.fails as number,
        };
      }),
    });
  }

  // ── Ordered vs weighed, by month — one line entered, one line at the scale ─
  if (report === "weightTrend") {
    const { customerFilter, productIds, productFilter } = multiSelectFilters(searchParams);
    const match = andFilters(visible, { status: "Posted" }, dated("postedAt"), customerFilter, productFilter);

    let rows;
    if (productIds.length) {
      rows = await SalesOrder.aggregate([
        { $match: match },
        { $unwind: "$lines" },
        { $match: { "lines.productId": { $in: productIds } } },
        {
          $group: {
            _id: { y: { $year: "$postedAt" }, m: { $month: "$postedAt" } },
            orderedKg: { $sum: "$lines.lineWeightKg" },
            // Orders posted before per-line weighing existed have no
            // per-line reading to sum — they show as 0 here, not missing;
            // see the caption the UI renders alongside this filter.
            actualKg: { $sum: { $ifNull: ["$lines.actualWeightKg", 0] } },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]);
    } else {
      rows = await SalesOrder.aggregate([
        { $match: match },
        {
          $group: {
            _id: { y: { $year: "$postedAt" }, m: { $month: "$postedAt" } },
            orderedKg: { $sum: "$totalWeightKg" },
            actualKg: { $sum: { $ifNull: ["$actualNetWeightKg", 0] } },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]);
    }

    return NextResponse.json({
      report,
      months: rows.map((r) => ({
        year: r._id.y as number,
        month: (r._id.m as number) - 1, // Mongo's $month is 1-based; JS Date months are 0-based
        orderedKg: r.orderedKg as number,
        actualKg: r.actualKg as number,
      })),
      filteredByProduct: productIds.length > 0,
    });
  }

  // ── The orders behind one point of the chart above ───────────────────────
  if (report === "weightTrendOrders") {
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month")); // 0-based, matching `weightTrend`'s own months[].month
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      return badRequest("A valid year and month (0-11) are required");
    }

    const { customerFilter, productFilter } = multiSelectFilters(searchParams);

    // The exact month the clicked point represents — same UTC-month bucket
    // `$year`/`$month` grouped by above, expressed as a plain date range so
    // this can be a `find`, not another aggregation.
    const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    const match = andFilters(
      visible,
      { status: "Posted", postedAt: { $gte: monthStart, $lte: monthEnd } },
      customerFilter,
      productFilter
    );

    const orders = await SalesOrder.find(match)
      .sort({ postedAt: -1 })
      .limit(200)
      .select("orderNumber customer customerAr totalWeightKg actualNetWeightKg varianceKg variancePct postedAt")
      .lean();

    return NextResponse.json({ report, orders });
  }

  // ── One row per order line, grouped by order ──────────────────────────────
  if (report === "orders") {
    const { customerFilter, productFilter } = multiSelectFilters(searchParams);
    const match = andFilters(visible, dated("orderDate"), customerFilter, productFilter);

    const orders = await SalesOrder.find(match)
      .sort({ orderDate: -1 })
      .limit(1000)
      .select("orderNumber customer customerAr orderDate deliveryDate lines labSampleIds")
      .lean();

    const labByOrder = await lineLabStatuses(orders as unknown as { _id: unknown; labSampleIds?: unknown[] }[]);

    return NextResponse.json({
      report,
      orders: orders.map((o) => {
        const d = o as unknown as Record<string, never>;
        const labByProduct = labByOrder.get(String(d._id)) ?? new Map();
        const lines = (d.lines ?? []) as unknown as {
          productId: unknown; product: string; productAr?: string; packaging?: string;
          bagWeightKg: number | null; bagCount: number | null;
          lineWeightKg: number; actualWeightKg: number | null;
        }[];
        return {
          _id: String(d._id),
          orderNumber: d.orderNumber as string,
          customer: d.customer as string,
          customerAr: (d.customerAr as string) ?? "",
          orderDate: d.orderDate as string,
          deliveryDate: (d.deliveryDate as string) ?? null,
          lines: lines.map((l) => ({
            productId: String(l.productId),
            product: l.product,
            productAr: l.productAr ?? "",
            // Passed through as stored — null on a bulk line, which the screen
            // renders as "صبّ" rather than as a missing number.
            packaging: l.packaging === "bulk" ? "bulk" : "bagged",
            bagWeightKg: l.bagWeightKg ?? null,
            bagCount: l.bagCount ?? null,
            lineWeightKg: l.lineWeightKg,
            actualWeightKg: l.actualWeightKg,
            labStatus: labByProduct.get(String(l.productId)) ?? null,
          })),
        };
      }),
    });
  }

  return badRequest("Unknown report");
}

/** Re-exported so the export route builds sheets from the same shapes. */
export { SALES_STAGES };
