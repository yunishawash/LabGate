import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession, notAbsentFilter } from "@/lib/requireSession";
import { dateRange, oid } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles, stagesOwnedBy } from "@/lib/salesAuth";
import { blocksFor, STUCK_HOURS, type BlockKey } from "@/lib/dashboardBlocks";
import SalesOrder from "@/models/SalesOrder";
import LabCustomer from "@/models/LabCustomer";
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
export async function GET(req: NextRequest) {
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

  /**
   * The dashboard's own top filter bar (date range / product / customer) —
   * separate from `visible`, which is authorization and is never optional.
   * Applied only to the reporting/analytics widgets below the "waiting on
   * you" queues: those queues (waitingOnMe, myOrders, labQueue, readyToWeigh)
   * answer "what needs me right now" and filtering them by a historical date
   * range would contradict their purpose, so they deliberately ignore these
   * params.
   */
  const { searchParams } = new URL(req.url);
  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  const customerId = oid(searchParams.get("customerId") || "");
  const productId = oid(searchParams.get("productId") || "");
  const cityId = oid(searchParams.get("cityId") || "");
  const dated = (field: string) => (range ? { [field]: range } : {});

  /**
   * The customer-scope the filter bar's city picker resolves to.
   *
   * A city isn't a field on the order — it's a field on the CUSTOMER — so
   * "orders from city X" means "orders from one of X's customers", resolved
   * to an id list once here rather than re-joined per aggregation. A specific
   * `customerId` wins over `cityId` when both are set (picking one customer
   * is the narrower, more specific choice; the city that customer happens to
   * be in is then implied, not a second independent condition to satisfy).
   */
  const cityCustomerScope: Record<string, unknown> = {};
  if (customerId) {
    cityCustomerScope.customerId = customerId;
  } else if (cityId) {
    const ids = await LabCustomer.find({ cityId }).distinct("_id");
    // An empty match rather than an unfiltered one: a city with zero
    // customers must show zero orders, not every order in the system.
    cityCustomerScope.customerId = { $in: ids.length ? ids : [null] };
  }
  /**
   * What a tonne SHIPPED is, as one expression.
   *
   * The weighbridge reading for this line, falling back to the ordered weight
   * for lines posted before weighing was recorded per line. Both the product
   * donut and the city donut sum THIS, over the same unwound lines, so their
   * totals are equal by construction rather than by two aggregations
   * happening to agree — which they did not: the product donut summed the
   * ordered weight while calling itself "tonnage shipped", and the two cards
   * showed 2346.9 t and 2352.0 t side by side.
   */
  const SHIPPED_KG = { $ifNull: ["$lines.actualWeightKg", "$lines.lineWeightKg"] };
  // Same definition, usable WITHOUT unwinding — needed where an order must
  // still count once (e.g. an order count per city) while its lines' weights
  // still need summing.
  const SHIPPED_KG_PER_ORDER = {
    $sum: { $map: { input: "$lines", as: "l", in: { $ifNull: ["$$l.actualWeightKg", "$$l.lineWeightKg"] } } },
  };

  const orderExtra: Record<string, unknown> = { ...cityCustomerScope };
  if (productId) orderExtra["lines.productId"] = productId;
  const sampleExtra: Record<string, unknown> = { ...cityCustomerScope };
  if (productId) sampleExtra.productId = productId;

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

  // C — the pipeline board — was dropped from the dashboard outright; no
  // role's block list requests it any more (see dashboardBlocks.ts), so
  // nothing here computes it either.

  // ── D · Stuck orders ─────────────────────────────────────────────────────
  if (want("stuck")) {
    const filter = andFilters(
      visible,
      { status: "Pending", currentStageEnteredAt: { $lt: stuckBefore } },
      orderExtra,
      dated("orderDate")
    );
    const [rows, total] = await Promise.all([
      SalesOrder.find(filter)
        // Fetched once, paginated client-side by the widget (see `Stuck` in
        // blocks.tsx) — a dashboard card, not a full list page, so a
        // generous cap beats adding a second paged endpoint for it.
        .sort({ currentStageEnteredAt: 1 }).limit(30)
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

    /**
     * "Previous" is the SAME NUMBER OF ELAPSED DAYS into last month, not all
     * of it — a month-to-date vs month-to-date comparison, not partial vs
     * complete.
     *
     * The earlier version compared `current` (1st of this month → now, which
     * grows every day) against ALL of last month. Early in a month that is 7
     * days of activity measured against ~30 — a reader sees "-74%" and reads
     * it as "we're behind", when it is really just "a week has passed and a
     * month hasn't". The percentage was never answering "better or worse",
     * only "how far through the month are we" — which the calendar already
     * shows.
     *
     * Capped at `startThis`: if last month had FEWER days than have elapsed
     * this month (comparing May 31st against April's 30 days), the window
     * stops at April's own end rather than spilling into May.
     */
    const elapsedMs = now.getTime() - startThis.getTime();
    const endLast = new Date(Math.min(startLast.getTime() + elapsedMs, startThis.getTime()));

    const period = async (from: Date, to: Date) => {
      const [posted, rejected] = await Promise.all([
        SalesOrder.aggregate([
          { $match: andFilters(visible, { status: "Posted", postedAt: { $gte: from, $lt: to } }, orderExtra) },
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
          { $match: andFilters(visible, { status: "Rejected", updatedAt: { $gte: from, $lt: to } }, orderExtra) },
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
      previous: await period(startLast, endLast),
    };
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
    const sampleWindow = range ?? { $gte: thirty };
    const days = range?.$gte
      ? Math.max(1, Math.round(((range.$lte ?? now).getTime() - range.$gte.getTime()) / 86400_000))
      : 30;
    const rows = await LabSample.aggregate([
      { $match: { isActive: true, sampleDate: sampleWindow, ...sampleExtra } },
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
      days,
    };
  }

  // ── the trend window, shared by K/L/M ─────────────────────────────────────
  // Defaults to the last 12 months; the filter bar's date range overrides it
  // when set, so a person filtering to a single quarter sees exactly that
  // quarter's months, not 12 months with most of them filtered to zero.
  const windowEnd = range?.$lte ?? now;
  const windowStart = range?.$gte ?? new Date(windowEnd.getFullYear(), windowEnd.getMonth() - 11, 1);

  /**
   * Fold `{year, month, …}` aggregation rows into a fixed per-month array in
   * calendar order, oldest first. A month with nothing in it is a REAL zero,
   * not a missing point — a chart that silently drops empty months hides
   * exactly the slow month it should be showing. Capped at 60 slots so an
   * open-ended custom range can't blow up the response.
   */
  function monthSlots(): { year: number; month: number }[] {
    const slots: { year: number; month: number }[] = [];
    const cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    const last = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
    for (let i = 0; cursor <= last && i < 60; i++) {
      slots.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return slots;
  }

  // volumeTrend removed 2026-10-07 (client request) — see the ROW1 comment
  // in the dashboard page for why: a dual-axis chart over data with no
  // meaningful correlation (r=0.24). Per-stage/reason rejection breakdown
  // moved to the Rejections report instead.


  // L — "Quality trend" (in-spec % by month) moved to its own route,
  // /api/dashboard/quality-trend — see that file for why: the card owns an
  // in-card parameter/product selector the page's top filters must not
  // drive. `qualityTrend` stays a BlockKey purely so ROLE_BLOCKS still
  // decides who the card renders FOR; nothing here computes its data — the
  // sentinel below is only so the page's `d[key] !== undefined` presence
  // check still lets the card through.
  if (want("qualityTrend")) data.qualityTrend = true;

  // ── M · Product mix — tonnage share, last 12 months, posted orders ───────
  if (want("productMix")) {
    const rows = await SalesOrder.aggregate([
      {
        $match: andFilters(
          visible,
          { status: "Posted", postedAt: { $gte: windowStart, $lte: windowEnd } },
          orderExtra
        ),
      },
      { $unwind: "$lines" },
      ...(productId ? [{ $match: { "lines.productId": productId } }] : []),
      {
        $group: {
          _id: { productId: "$lines.productId", product: "$lines.product", productAr: "$lines.productAr" },
          kg: { $sum: SHIPPED_KG },
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

  /**
   * ── N · Posted orders per city — count + tonnage ────────────────────────
   *
   * POSTED only, by client request (2026-10-08): a rejected order never
   * shipped, so it has no place on a chart about what a city received. What
   * doesn't ship belongs to the Rejections report, not here.
   *
   * Joined through the customer, because a city belongs to the customer and
   * an order belongs to the customer — an order has no city of its own.
   */
  if (want("ordersByCity")) {
    const rows = await SalesOrder.aggregate([
      {
        $match: andFilters(
          visible,
          { status: "Posted", postedAt: { $gte: windowStart, $lte: windowEnd } },
          orderExtra
        ),
      },
      { $lookup: { from: "labcustomers", localField: "customerId", foreignField: "_id", as: "c" } },
      { $unwind: { path: "$c", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "cities", localField: "c.cityId", foreignField: "_id", as: "city" } },
      { $unwind: { path: "$city", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { cityId: "$city._id", name: "$city.name", nameAr: "$city.nameAr" },
          orders: { $sum: 1 },
          kg: { $sum: SHIPPED_KG_PER_ORDER },
        },
      },
      { $sort: { orders: -1 } },
    ]);

    /**
     * Customers with no city on file are kept as their own bucket, not
     * dropped — dropping them would make the bars stop adding up to the
     * period's orders — but it sorts LAST however big it is, the same place
     * "Others" takes in the product donut. A miscellaneous bucket at the head
     * of a ranked chart reads as the top city.
     */
    const withCity = rows.filter((r) => r._id.cityId);
    const noCity = rows.filter((r) => !r._id.cityId);

    data.ordersByCity = {
      rows: [...withCity, ...noCity].map((r) => ({
        cityId: String(r._id.cityId ?? ""),
        // A customer with no city still has orders; they are shown as their
        // own bar rather than dropped, so the totals still add up.
        city: (r._id.name as string) ?? "",
        cityAr: (r._id.nameAr as string) ?? "",
        orders: r.orders as number,
        kg: r.kg as number,
      })),
    };
  }

  /**
   * ── N2 · Orders over time — tonnage posted per month ────────────────────
   *
   * Same shape as the per-city tonnage below, grouped by month instead of
   * city — one series, so the client can see volume trending up or down
   * without the dual-axis trap `volumeTrend` fell into (see the removal note
   * above this block).
   */
  if (want("ordersByMonth")) {
    const rows = await SalesOrder.aggregate([
      {
        $match: andFilters(
          visible,
          { status: "Posted", postedAt: { $gte: windowStart, $lte: windowEnd } },
          orderExtra
        ),
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { y: { $year: "$postedAt" }, m: { $month: "$postedAt" } },
          kg: { $sum: SHIPPED_KG },
          orderIds: { $addToSet: "$_id" },
        },
      },
    ]);
    const byKey = new Map<string, { kg: number; orders: number }>();
    for (const r of rows) {
      byKey.set(`${r._id.y}-${r._id.m}`, { kg: r.kg as number, orders: (r.orderIds as unknown[]).length });
    }
    data.ordersByMonth = monthSlots().map(({ year, month }) => {
      const c = byKey.get(`${year}-${month + 1}`);
      return { year, month, kg: c?.kg ?? 0, orders: c?.orders ?? 0 };
    });
  }

  /**
   * ── O · Share of tonnage sold, per city ─────────────────────────────────
   *
   * POSTED orders only — "sold" means it left the mill, not that somebody
   * asked for it — and the ACTUAL net weight the weighbridge recorded, falling
   * back to the ordered weight for orders posted before per-line weighing
   * existed. The same expression `volumeTrend` uses, so the two charts cannot
   * disagree about what a tonne is.
   *
   * Top seven cities plus an "Others" bucket: the categorical palette has
   * seven hues and an eighth is never a generated colour. Sixteen slices would
   * be unreadable anyway.
   */
  if (want("tonsByCity")) {
    const rows = await SalesOrder.aggregate([
      {
        $match: andFilters(
          visible,
          { status: "Posted", postedAt: { $gte: windowStart, $lte: windowEnd } },
          orderExtra
        ),
      },
      // Joined BEFORE the unwind: the city belongs to the order, so looking it
      // up once per order beats once per line.
      { $lookup: { from: "labcustomers", localField: "customerId", foreignField: "_id", as: "c" } },
      { $unwind: { path: "$c", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "cities", localField: "c.cityId", foreignField: "_id", as: "city" } },
      { $unwind: { path: "$city", preserveNullAndEmptyArrays: true } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { cityId: "$city._id", name: "$city.name", nameAr: "$city.nameAr" },
          kg: { $sum: SHIPPED_KG },
        },
      },
      { $sort: { kg: -1 } },
    ]);

    const totalKg = rows.reduce((sum, r) => sum + (r.kg as number), 0);
    const top = rows.slice(0, 7);
    const rest = rows.slice(7).reduce((sum, r) => sum + (r.kg as number), 0);

    data.tonsByCity = {
      totalKg,
      slices: [
        ...top.map((r) => ({
          cityId: String(r._id.cityId ?? ""),
          city: (r._id.name as string) ?? "",
          cityAr: (r._id.nameAr as string) ?? "",
          kg: r.kg as number,
        })),
        ...(rest > 0 ? [{ cityId: "__others", city: "Others", cityAr: "أخرى", kg: rest }] : []),
      ],
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
