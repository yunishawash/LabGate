import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, dateRange, oneOf } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";

const REPORTS = ["cycleTime", "rejections", "variance", "customers", "coverage"] as const;
export type ReportKey = (typeof REPORTS)[number];

/**
 * Percentile from an unsorted sample, computed in JavaScript.
 *
 * MongoDB here is 6.x and `$percentile` needs 7+. The alternative — `$push` the
 * durations and reduce in the pipeline — is both slower and unreadable, and the
 * lab module already sets the precedent of computing CV% and ratings in JS.
 */
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: with 4 samples a "p90" between two points is a fiction, and
  // interpolating would invent a duration nobody ever waited.
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

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
  const report = oneOf(searchParams.get("report"), REPORTS, "cycleTime") as ReportKey;
  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  const dated = (field: string) => (range ? { [field]: range } : {});

  // ── How long each desk holds an order, and who is slow ───────────────────
  if (report === "cycleTime") {
    /**
     * `steps.enteredAt` is stored precisely so this is possible: the wait is
     * `actedAt - enteredAt` for that step, not the age of the order. Without it
     * a slow approver at stage 5 would look identical to a slow one at stage 2.
     */
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, dated("createdAt")) },
      { $unwind: "$steps" },
      {
        $match: {
          "steps.actedAt": { $ne: null },
          "steps.enteredAt": { $ne: null },
          // Stage 1 is the creation itself: `enteredAt` and `actedAt` are the
          // same instant, so it would report a flat zero and pad the table with
          // a row that answers nothing. How long somebody took to create the
          // order they were creating is not a cycle time.
          "steps.kind": { $ne: "create" },
        },
      },
      {
        $project: {
          stageKey: "$steps.stageKey",
          stageIndex: "$steps.stageIndex",
          actedById: "$steps.actedById",
          actedByName: "$steps.actedByName",
          actedAs: "$steps.actedAs",
          hours: {
            $divide: [{ $subtract: ["$steps.actedAt", "$steps.enteredAt"] }, 3600000],
          },
        },
      },
      {
        $group: {
          _id: { stageKey: "$stageKey", stageIndex: "$stageIndex" },
          n: { $sum: 1 },
          avg: { $avg: "$hours" },
          max: { $max: "$hours" },
          all: { $push: "$hours" },
          people: {
            $push: { id: "$actedById", name: "$actedByName", hours: "$hours", actedAs: "$actedAs" },
          },
        },
      },
      { $sort: { "_id.stageIndex": 1 } },
    ]);

    const byStage = rows.map((r) => {
      const people = new Map<string, { name: string; n: number; total: number }>();
      for (const p of r.people as { id: unknown; name: string; hours: number }[]) {
        const key = p.name || String(p.id);
        const cur = people.get(key) ?? { name: p.name || "—", n: 0, total: 0 };
        cur.n += 1;
        cur.total += p.hours;
        people.set(key, cur);
      }
      return {
        stageKey: r._id.stageKey as string,
        stageIndex: r._id.stageIndex as number,
        n: r.n as number,
        avgHours: round1(r.avg as number),
        p90Hours: round1(percentile(r.all as number[], 90)),
        maxHours: round1(r.max as number),
        people: [...people.values()]
          .map((p) => ({ name: p.name, n: p.n, avgHours: round1(p.total / p.n) }))
          .sort((a, b) => (b.avgHours ?? 0) - (a.avgHours ?? 0)),
      };
    });

    return NextResponse.json({ report, byStage });
  }

  // ── Why orders die, and where ────────────────────────────────────────────
  if (report === "rejections") {
    const match = andFilters(visible, { status: "Rejected" }, dated("updatedAt"));
    const [byStage, reasons, denominators] = await Promise.all([
      SalesOrder.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$rejection.stageIndex",
            count: { $sum: 1 },
            kg: { $sum: "$totalWeightKg" },
            rejectors: { $addToSet: "$rejection.byName" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      SalesOrder.find(match)
        .sort({ updatedAt: -1 }).limit(50)
        .select("orderNumber customer customerAr totalWeightKg rejection updatedAt")
        .lean(),
      /**
       * The denominator for a rejection RATE is not "all orders" — it is the
       * orders that actually reached that stage. Two rejections out of three
       * arrivals at finance is a different fact from two out of ninety.
       */
      Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          SalesOrder.countDocuments(
            andFilters(visible, { currentStageIndex: { $gte: i + 1 } }, dated("createdAt"))
          ).then((reached) => ({ stageIndex: i + 1, reached }))
        )
      ),
    ]);

    const reachedBy = new Map(denominators.map((d) => [d.stageIndex, d.reached]));
    return NextResponse.json({
      report,
      byStage: byStage.map((s) => ({
        stageIndex: s._id as number | null,
        count: s.count as number,
        kg: s.kg as number,
        rejectors: (s.rejectors as string[]).filter(Boolean),
        reached: reachedBy.get(s._id as number) ?? 0,
        ratePct: reachedBy.get(s._id as number)
          ? Math.round((s.count / (reachedBy.get(s._id as number) as number)) * 1000) / 10
          : null,
      })),
      recent: reasons,
    });
  }

  // ── Are we shipping what we sold ─────────────────────────────────────────
  if (report === "variance") {
    const match = andFilters(visible, { status: "Posted" }, dated("postedAt"));
    const [byCustomer, outliers, overall] = await Promise.all([
      SalesOrder.aggregate([
        { $match: match },
        {
          $group: {
            _id: { id: "$customerId", name: "$customer", nameAr: "$customerAr" },
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
        customerId: String(c._id.id ?? ""),
        name: c._id.name as string,
        nameAr: (c._id.nameAr as string) ?? "",
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
        $group: {
          _id: { id: "$customerId", name: "$customer", nameAr: "$customerAr" },
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
          customerId: String(r._id.id ?? ""),
          name: r._id.name as string,
          nameAr: (r._id.nameAr as string) ?? "",
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

  // ── How often a desk is signed by somebody other than its owner ──────────
  if (report === "coverage") {
    /**
     * A stage covered 60% of the time by a deputy is a staffing fact management
     * should see, not a hidden one — and it is only visible because every
     * signature records `actedAs` and `actedForRole` rather than pretending the
     * stand-in was the owner.
     */
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, dated("createdAt")) },
      { $unwind: "$steps" },
      { $match: { "steps.actedAt": { $ne: null } } },
      {
        $group: {
          _id: { stageIndex: "$steps.stageIndex", actedAs: "$steps.actedAs" },
          count: { $sum: 1 },
          people: { $addToSet: "$steps.actedByName" },
        },
      },
      { $sort: { "_id.stageIndex": 1 } },
    ]);

    const byStage = new Map<number, { stageIndex: number; total: number; kinds: Record<string, number>; people: string[] }>();
    for (const r of rows) {
      const i = r._id.stageIndex as number;
      const cur = byStage.get(i) ?? { stageIndex: i, total: 0, kinds: {}, people: [] };
      const kind = (r._id.actedAs as string) || "primary";
      cur.total += r.count as number;
      cur.kinds[kind] = (cur.kinds[kind] ?? 0) + (r.count as number);
      cur.people = Array.from(new Set([...cur.people, ...((r.people as string[]) ?? [])])).filter(Boolean);
      byStage.set(i, cur);
    }

    return NextResponse.json({
      report,
      byStage: [...byStage.values()]
        .sort((a, b) => a.stageIndex - b.stageIndex)
        .map((s) => ({
          ...s,
          coveredPct: s.total
            ? Math.round(((s.total - (s.kinds.primary ?? 0)) / s.total) * 1000) / 10
            : 0,
        })),
    });
  }

  return badRequest("Unknown report");
}

/** Re-exported so the export route builds sheets from the same shapes. */
export { SALES_STAGES };
