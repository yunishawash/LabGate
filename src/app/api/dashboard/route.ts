import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession, notAbsentFilter } from "@/lib/requireSession";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles, stagesOwnedBy } from "@/lib/salesAuth";
import { blocksFor, STUCK_HOURS, type BlockKey } from "@/lib/dashboardBlocks";
import SalesOrder from "@/models/SalesOrder";
import LabSample from "@/models/LabSample";
import Delegation from "@/models/Delegation";
import User from "@/models/User";

/**
 * Everything the dashboard needs, in one request, for this role only.
 *
 * Two rules hold throughout, and neither is optional:
 *
 *  1. **Every number goes through `visibilityFilter` first.** A card reading
 *     "24 in the pipeline" shown to someone who may see 9 is not merely wrong —
 *     it tells them 15 orders exist that they are not allowed to know about.
 *  2. **The server picks the blocks.** The page renders what it is handed. A
 *     role ladder in the client would be a second copy of `ROLE_BLOCKS`, free to
 *     drift from the one the API computes with.
 */
export async function GET(_req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);
  const visible = visibilityFilter(actor, delegated);
  const blocks = blocksFor(actor.role);
  const want = (k: BlockKey) => blocks.includes(k);

  const now = new Date();
  const stuckBefore = new Date(now.getTime() - STUCK_HOURS * 3600_000);

  const data: Record<string, unknown> = {};

  // ── A · Waiting on me ────────────────────────────────────────────────────
  if (want("waitingOnMe")) {
    const owned = stagesOwnedBy(actor.role, delegated);
    const indexes = Array.from(new Set(owned.map((s) => s.index)));
    const filter = andFilters(visible, {
      status: "Pending",
      currentStageIndex: { $in: indexes.length ? indexes : [-1] },
    });
    // Oldest first: the whole point of the block is what has waited longest.
    const [rows, total] = await Promise.all([
      SalesOrder.find(filter)
        .sort({ currentStageEnteredAt: 1 })
        .limit(5)
        .select("orderNumber customer customerAr totalWeightKg currentStageIndex currentStageEnteredAt")
        .lean(),
      SalesOrder.countDocuments(filter),
    ]);
    data.waitingOnMe = { rows, total };
  }

  // ── B · My orders ────────────────────────────────────────────────────────
  if (want("myOrders")) {
    const mine = { createdById: userDoc._id, isActive: true };
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
    const [live, rejected] = await Promise.all([
      SalesOrder.find({ ...mine, status: "Pending" })
        .sort({ createdAt: -1 }).limit(6)
        .select("orderNumber customer customerAr totalWeightKg currentStageIndex currentStageEnteredAt")
        .lean(),
      SalesOrder.find({ ...mine, status: "Rejected", updatedAt: { $gte: thirtyDaysAgo } })
        .sort({ updatedAt: -1 }).limit(4)
        .select("orderNumber customer customerAr rejection")
        .lean(),
    ]);
    data.myOrders = { live, rejected };
  }

  // ── C · Pipeline board ───────────────────────────────────────────────────
  if (want("pipeline")) {
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, { status: "Pending" }) },
      {
        $group: {
          _id: "$currentStageIndex",
          count: { $sum: 1 },
          kg: { $sum: "$totalWeightKg" },
          oldest: { $min: "$currentStageEnteredAt" },
        },
      },
    ]);
    const byIndex = new Map(rows.map((r) => [r._id as number, r]));
    data.pipeline = Array.from({ length: 8 }, (_, i) => {
      const r = byIndex.get(i + 1);
      return { index: i + 1, count: r?.count ?? 0, kg: r?.kg ?? 0, oldest: r?.oldest ?? null };
    });
  }

  // ── D · Stuck orders ─────────────────────────────────────────────────────
  if (want("stuck")) {
    const filter = andFilters(visible, {
      status: "Pending",
      currentStageEnteredAt: { $lt: stuckBefore },
    });
    const [rows, total] = await Promise.all([
      SalesOrder.find(filter)
        .sort({ currentStageEnteredAt: 1 }).limit(6)
        .select("orderNumber customer customerAr currentStageIndex currentStageEnteredAt totalWeightKg")
        .lean(),
      SalesOrder.countDocuments(filter),
    ]);
    data.stuck = { rows, total, hours: STUCK_HOURS };
  }

  // ── E · This month, against last ─────────────────────────────────────────
  if (want("thisMonth")) {
    const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const period = async (from: Date, to: Date) => {
      const [posted, rejected] = await Promise.all([
        SalesOrder.aggregate([
          { $match: andFilters(visible, { status: "Posted", postedAt: { $gte: from, $lt: to } }) },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              kg: { $sum: { $ifNull: ["$actualNetWeightKg", "$totalWeightKg"] } },
              // A plain mean, so $avg is right here. The p90 in Reports is the
              // one Mongo 6 cannot do and that computes in JS.
              hours: { $avg: { $divide: [{ $subtract: ["$postedAt", "$createdAt"] }, 3600000] } },
            },
          },
        ]),
        SalesOrder.aggregate([
          { $match: andFilters(visible, { status: "Rejected", updatedAt: { $gte: from, $lt: to } }) },
          { $group: { _id: null, count: { $sum: 1 }, kg: { $sum: "$totalWeightKg" } } },
        ]),
      ]);
      return {
        postedCount: posted[0]?.count ?? 0,
        postedKg: posted[0]?.kg ?? 0,
        avgHours: posted[0]?.hours ?? null,
        rejectedCount: rejected[0]?.count ?? 0,
        rejectedKg: rejected[0]?.kg ?? 0,
      };
    };

    data.thisMonth = {
      current: await period(startThis, now),
      previous: await period(startLast, startThis),
    };
  }

  // ── F · Rejections ───────────────────────────────────────────────────────
  if (want("rejections")) {
    const rejected = andFilters(visible, { status: "Rejected" });
    const [recent, byStage] = await Promise.all([
      SalesOrder.find(rejected)
        .sort({ updatedAt: -1 }).limit(5)
        .select("orderNumber customer customerAr totalWeightKg rejection updatedAt")
        .lean(),
      SalesOrder.aggregate([
        { $match: rejected },
        { $group: { _id: "$rejection.stageIndex", count: { $sum: 1 }, kg: { $sum: "$totalWeightKg" } } },
        { $sort: { count: -1 } },
      ]),
    ]);
    data.rejections = { recent, byStage };
  }

  // ── G · Lab queue ────────────────────────────────────────────────────────
  if (want("labQueue")) {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [awaiting, today] = await Promise.all([
      SalesOrder.find(andFilters(visible, { status: "Pending", currentStageIndex: 6 }))
        .sort({ currentStageEnteredAt: 1 }).limit(6)
        .select("orderNumber customer customerAr totalWeightKg currentStageEnteredAt")
        .lean(),
      LabSample.find({ isActive: true, createdAt: { $gte: startOfDay } })
        .sort({ createdAt: -1 }).limit(10)
        .select("sampleNumber product overallStatus orderNumber createdAt")
        .lean(),
    ]);
    data.labQueue = {
      awaiting,
      today,
      fails: today.filter((s) => (s as { overallStatus?: string }).overallStatus === "fail").length,
    };
  }

  // ── H · Quality signal ───────────────────────────────────────────────────
  if (want("quality")) {
    const thirty = new Date(now.getTime() - 30 * 86400_000);
    const rows = await LabSample.aggregate([
      { $match: { isActive: true, createdAt: { $gte: thirty } } },
      { $group: { _id: "$overallStatus", count: { $sum: 1 } } },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r._id, r.count])) as Record<string, number>;
    const pass = by.pass ?? 0, warning = by.warning ?? 0, fail = by.fail ?? 0;
    const total = pass + warning + fail;
    data.quality = {
      pass, warning, fail, total,
      // "In spec" counts warnings: a warning is inside the accepted range, just
      // near a limit. Excluding them would understate quality.
      inSpecPct: total ? Math.round(((pass + warning) / total) * 1000) / 10 : null,
      days: 30,
    };
  }

  // ── the last-12-months window, shared by K/L/M ───────────────────────────
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  /**
   * Fold `{year, month, …}` aggregation rows into a fixed 12-slot array in
   * calendar order, oldest first. A month with nothing in it is a REAL zero,
   * not a missing point — a chart that silently drops empty months hides
   * exactly the slow month it should be showing.
   */
  function twelveMonthSlots(): { year: number; month: number }[] {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  // ── K · Volume trend — tonnage bars + rejection-rate line, by month ──────
  if (want("volumeTrend")) {
    const [tonnageRows, outcomeRows] = await Promise.all([
      SalesOrder.aggregate([
        { $match: andFilters(visible, { status: "Posted", postedAt: { $gte: twelveMonthsAgo } }) },
        {
          $group: {
            _id: { y: { $year: "$postedAt" }, m: { $month: "$postedAt" } },
            kg: { $sum: { $ifNull: ["$actualNetWeightKg", "$totalWeightKg"] } },
            orders: { $sum: 1 },
          },
        },
      ]),
      // Rate is a COHORT measure — of the orders raised in month M that have
      // since resolved, what share died? Orders still open don't count on
      // either side yet; counting them as "not rejected" would understate a
      // month that simply hasn't finished playing out.
      SalesOrder.aggregate([
        {
          $match: andFilters(visible, {
            status: { $in: ["Posted", "Rejected"] },
            createdAt: { $gte: twelveMonthsAgo },
          }),
        },
        {
          $group: {
            _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" }, status: "$status" },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);

    const tonnageByKey = new Map(tonnageRows.map((r) => [`${r._id.y}-${r._id.m}`, r]));
    const outcomeByKey = new Map<string, { posted: number; rejected: number }>();
    for (const r of outcomeRows) {
      const key = `${r._id.y}-${r._id.m}`;
      const cur = outcomeByKey.get(key) ?? { posted: 0, rejected: 0 };
      if (r._id.status === "Posted") cur.posted += r.n; else cur.rejected += r.n;
      outcomeByKey.set(key, cur);
    }

    data.volumeTrend = twelveMonthSlots().map(({ year, month }) => {
      const key = `${year}-${month + 1}`; // Mongo's $month is 1-based
      const t = tonnageByKey.get(key);
      const o = outcomeByKey.get(key);
      const resolved = (o?.posted ?? 0) + (o?.rejected ?? 0);
      return {
        year, month, kg: t?.kg ?? 0, orders: t?.orders ?? 0,
        rejectionRatePct: resolved ? Math.round(((o!.rejected / resolved) * 1000)) / 10 : null,
      };
    });
  }

  // ── L · Quality trend — in-spec % by month ────────────────────────────────
  if (want("qualityTrend")) {
    // Plant-wide, not order-scoped — the same precedent the "quality" block
    // above already sets in its own caption: lab data isn't confidentiality-
    // gated by the sales chain, samples aren't all linked to an order.
    const rows = await LabSample.aggregate([
      { $match: { isActive: true, createdAt: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" }, status: "$overallStatus" },
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
    data.qualityTrend = twelveMonthSlots().map(({ year, month }) => {
      const key = `${year}-${month + 1}`;
      const c = byKey.get(key);
      const total = c ? c.pass + c.warning + c.fail : 0;
      return {
        year, month, samples: total,
        inSpecPct: total ? Math.round(((c!.pass + c!.warning) / total) * 1000) / 10 : null,
      };
    });
  }

  // ── M · Product mix — tonnage share, last 12 months, posted orders ───────
  if (want("productMix")) {
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, { status: "Posted", postedAt: { $gte: twelveMonthsAgo } }) },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { productId: "$lines.productId", product: "$lines.product", productAr: "$lines.productAr" },
          kg: { $sum: "$lines.lineWeightKg" },
        },
      },
      { $sort: { kg: -1 } },
    ]);
    const totalKg = rows.reduce((s, r) => s + r.kg, 0);
    const top = rows.slice(0, 7);
    const rest = rows.slice(7).reduce((s, r) => s + r.kg, 0);
    data.productMix = {
      slices: [
        ...top.map((r) => ({
          productId: String(r._id.productId ?? ""),
          product: r._id.product as string,
          productAr: (r._id.productAr as string) ?? "",
          kg: r.kg as number,
        })),
        ...(rest > 0 ? [{ productId: "", product: "Others", productAr: "أخرى", kg: rest }] : []),
      ],
      totalKg,
    };
  }

  // ── I · Ready to weigh ───────────────────────────────────────────────────
  if (want("readyToWeigh")) {
    const filter = andFilters(visible, { status: "Pending", currentStageIndex: 8 });
    const [rows, total, awaitingSignoff] = await Promise.all([
      SalesOrder.find(filter)
        .sort({ currentStageEnteredAt: 1 }).limit(8)
        .select("orderNumber customer customerAr totalWeightKg totalBags currentStageEnteredAt labOverallStatus")
        .lean(),
      SalesOrder.countDocuments(filter),
      SalesOrder.countDocuments(andFilters(visible, { status: "Pending", currentStageIndex: 7 })),
    ]);
    data.readyToWeigh = { rows, total, awaitingSignoff };
  }

  // ── J · Coverage: what is in force for YOU, right now ────────────────────
  if (want("coverage")) {
    const [givingOut, holding, me] = await Promise.all([
      Delegation.find({ fromUserId: userDoc._id, isActive: true, from: { $lte: now }, to: { $gte: now } })
        .select("role toUserName to").lean(),
      Delegation.find({ toUserId: userDoc._id, isActive: true, from: { $lte: now }, to: { $gte: now } })
        .select("role to").lean(),
      User.findById(userDoc._id).select("isAbsent absentFrom absentTo").lean(),
    ]);

    const absent = me as { isAbsent?: boolean; absentFrom?: Date | null; absentTo?: Date | null } | null;
    const away =
      absent?.isAbsent === true ||
      (!!absent?.absentFrom && absent.absentFrom <= now && (!absent.absentTo || absent.absentTo >= now));

    /**
     * If this person is away, who is actually covering their stage? Answering it
     * here lets the strip say "the Accounts Officer has stage 3" rather than
     * leaving them wondering whether anything is being handled at all.
     */
    let coveredBy: { role: string; names: string[] }[] = [];
    if (away) {
      const stages = SALES_STAGES.filter((s) => s.role === actor.role && s.deputyRole);
      coveredBy = await Promise.all(
        stages.map(async (s) => ({
          role: s.deputyRole as string,
          names: (
            await User.find({ role: s.deputyRole, isActive: true, ...notAbsentFilter(now) })
              .select("name").lean()
          ).map((u) => (u as { name: string }).name),
        }))
      );
    }

    data.coverage = { away, absentTo: absent?.absentTo ?? null, givingOut, holding, coveredBy };
  }

  // The number every empty state wants to quote: "nothing waiting on you —
  // 6 orders are moving through the chain".
  const inChain = await SalesOrder.countDocuments(andFilters(visible, { status: "Pending" }));

  return NextResponse.json({ role: actor.role, blocks, data, inChain });
}
