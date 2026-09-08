/**
 * 400 orders, spread across the year ending today, with different outcomes
 * and a few deliberate "stories" baked in — so the new dashboard charts have
 * something worth looking at instead of a flat line.
 *
 * WHY RAW INSERTS, NOT `SalesOrder.create()`: Mongoose's timestamps plugin
 * always stamps `createdAt` with `Date.now()` on create, ignoring an explicit
 * value in the document — which is exactly the field this script needs to
 * backdate. `collection.insertMany()` bypasses Mongoose entirely (no
 * validation, no defaults, no timestamps middleware), the same convention the
 * equipment importer in the CMMS uses for the same reason. Every document
 * below is therefore built COMPLETE by hand, matching the real schema shape
 * field-for-field — see `src/models/SalesOrder.ts` / `LabSample.ts`.
 *
 * WHY THE REJECTION SHAPE IS COPIED, NOT INVENTED: `rejectOrder()` in
 * `salesTransition.ts` sets every still-pending step to "skipped" first, then
 * overwrites the rejector's OWN slot (matched by role) to "rejected". If the
 * rejector's role doesn't match any live stage at that index — the GM
 * overriding a stage that isn't stage 4 or 7 — NO step ends up "rejected",
 * only the order-level `rejection` field records it, and the timeline has
 * nothing to turn red. That's a real edge case in the app, not something to
 * silently paper over here: this generator simply never produces it — a
 * rejector is always the stage's own role holder, which is what actually
 * happens on the vast majority of real rejections anyway.
 *
 * Nothing here fires a notification or writes an audit entry. This is a
 * historical backfill, not 400 live actions — notifying every user about
 * something that "happened" a year ago would be noise, not information.
 *
 *   npx tsx src/scripts/seed-demo-orders.ts            # add 400 orders
 *   npx tsx src/scripts/seed-demo-orders.ts --count=800 # a different amount
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { nextSequence } from "../models/Counter";
import { SALES_STAGES, type StageDef } from "../lib/salesWorkflow";
import { evaluate, deviationFromTarget } from "../lib/labQc";
import { BAG_WEIGHTS } from "../types";

const ARGV = process.argv.slice(2);
const COUNT = Number(ARGV.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 400);
const TODAY = new Date();

// ── tiny helpers ────────────────────────────────────────────────────────
const rand = () => Math.random();
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const randFloat = (a: number, b: number) => a + rand() * (b - a);
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

function pickWeighted<T>(items: { item: T; w: number }[]): T {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rand() * total;
  for (const i of items) {
    r -= i.w;
    if (r <= 0) return i.item;
  }
  return items[items.length - 1].item;
}

/**
 * How long a step sits before someone acts on it. Mostly quick, with an 8%
 * "someone was slow" tail — real enough to give the cycle-time report a p90
 * worth looking at, rather than every row being identical.
 */
function stepDuration(kind: string): number {
  if (kind === "data_entry") return randFloat(2, 40); // lab turnaround
  if (kind === "weigh") return randFloat(0.2, 6);
  const base = -Math.log(1 - rand() * 0.98) * 5; // exponential-ish, mean ~5h
  const slow = rand() < 0.08 ? randFloat(20, 70) : 0;
  return Math.min(base + slow, 90);
}

async function main() {
  await connectDB();
  const LabCustomer = (await import("../models/LabCustomer")).default;
  const LabProduct = (await import("../models/LabProduct")).default;
  const User = (await import("../models/User")).default;
  // SalesOrder itself is never called — every order is written through the raw
  // collection below (see the file header for why), but importing the model
  // still registers its Mongoose schema, which LabSample's `orderId` ref and
  // `connectDB()`'s own model wiring rely on being present.
  await import("../models/SalesOrder");
  const LabSample = (await import("../models/LabSample")).default;

  const customers = await LabCustomer.find({ isActive: true })
    .select("_id name nameAr").lean() as { _id: mongoose.Types.ObjectId; name: string; nameAr?: string }[];
  const products = await LabProduct.find({ isActive: true })
    .select("_id name nameAr").lean() as { _id: mongoose.Types.ObjectId; name: string; nameAr?: string }[];
  const usersByRole = new Map<string, { _id: mongoose.Types.ObjectId; name: string }>();
  for (const u of await User.find({ isActive: true }).select("_id name role").lean() as
    { _id: mongoose.Types.ObjectId; name: string; role: string }[]) {
    usersByRole.set(u.role, { _id: u._id, name: u.name });
  }
  const need = ["sales_coordinator", "sales_manager", "finance_manager", "accountant",
    "general_manager", "technical_manager", "lab_technician", "weighbridge"];
  const missing = need.filter((r) => !usersByRole.has(r));
  if (missing.length) {
    console.error(`Missing seeded users for role(s): ${missing.join(", ")}. Run "npm run seed:sales" first.`);
    process.exit(1);
  }
  if (!customers.length || !products.length) {
    console.error("No customers or products found. Run the lab seed first.");
    process.exit(1);
  }

  const damagedStarch = { min: 1.5, max: 5, target: 3.25, operator: "range" as const };
  // Confirmed by hand against the seeded LabParameter (see mongosh output) —
  // it's the one parameter with both a min AND a max, so it's the one that
  // actually has a warning band (see `warningBand()` in labQc.ts: a bare
  // n_m_t/n_l_t limit with no target has no band at all, and can only ever
  // score pass or fail).
  const damagedStarchParam = await mongoose.connection.collection("labparameters")
    .findOne({ name: "Damaged Starch" });
  if (!damagedStarchParam) {
    console.error('LabParameter "Damaged Starch" not found. Run the lab seed first.');
    process.exit(1);
  }

  // ── the "stories" — deliberate variation, not noise ──────────────────
  const monthsAgo = (n: number) => { const d = new Date(TODAY); d.setMonth(d.getMonth() - n); return d; };
  const badQualityMonth = monthKey(monthsAgo(5));   // a bad batch — fail rate spikes
  const toughFinanceMonth = monthKey(monthsAgo(8)); // a budget squeeze — finance rejects hard
  const slowVolumeMonth = monthKey(monthsAgo(3));   // a quiet month — Eid, maintenance shutdown

  // Pareto-ish weights by name, matched to whatever is actually seeded — a
  // real flour mill doesn't sell every grade or serve every customer equally.
  const productWeight: Record<string, number> = {
    WFP: 24, Super: 16, "Bab 1": 14, Sanabel: 13, "302": 11, Fakher: 9, "305": 8, Bab2: 5,
  };
  const customerWeight: Record<string, number> = {
    "Al Baraka Bakery": 22, "Abu Shusha Bakery": 18, "Al Balad Bakery": 14,
    "Palestine Poultry Co.": 12, "Khader Salem & Sons": 11, "Beit Sira Bakery": 9,
    "Khader Ashour": 8, "Khawaja Co.": 6,
  };
  const weightedProducts = products.map((p) => ({ item: p, w: productWeight[p.name] ?? 5 }));
  const weightedCustomers = customers.map((c) => ({ item: c, w: customerWeight[c.name] ?? 5 }));

  const REJECT_REASONS: Record<number, { en: string; ar: string }[]> = {
    2: [
      { en: "Price not competitive for this customer", ar: "السعر غير منافس لهذا الزبون" },
      { en: "Duplicates an order already in the pipeline", ar: "تكرار لطلبية موجودة أصلاً" },
    ],
    3: [
      { en: "Customer has an overdue balance", ar: "على الزبون رصيد متأخر" },
      { en: "Grade unavailable this month", ar: "الصنف غير متوفر هذا الشهر" },
      { en: "Budget on hold for this account", ar: "الميزانية موقوفة لهذا الحساب" },
      { en: "Customer cancelled", ar: "ألغى الزبون الطلب" },
    ],
    4: [
      { en: "Strategic hold — awaiting new pricing", ar: "إيقاف استراتيجي — بانتظار تسعيرة جديدة" },
      { en: "Quantity exceeds this month's allocation", ar: "الكمية تتجاوز حصة هذا الشهر" },
    ],
    5: [
      { en: "Production line unavailable for this grade this week", ar: "خط الإنتاج غير متاح لهذا الصنف هذا الأسبوع" },
      { en: "Raw wheat stock insufficient", ar: "مخزون القمح الخام غير كافٍ" },
    ],
    6: [
      { en: "Customer withdrew before results were ready", ar: "سحب الزبون الطلب قبل جهوزية النتائج" },
    ],
    7: [
      { en: "Lab results below acceptable grade", ar: "نتائج المختبر دون الدرجة المقبولة" },
      { en: "Quality dispute with the customer's own lab", ar: "خلاف على الجودة مع مختبر الزبون" },
    ],
  };

  const stagesByIndex = new Map<number, StageDef[]>();
  for (const s of SALES_STAGES) {
    if (!stagesByIndex.has(s.index)) stagesByIndex.set(s.index, []);
    stagesByIndex.get(s.index)!.push(s);
  }

  // ── weighted day-of-year pool: growth trend + weekday shape + the slow month ──
  type DayBucket = { daysAgo: number; date: Date; w: number };
  const days: DayBucket[] = [];
  for (let daysAgo = 0; daysAgo < 365; daysAgo++) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - daysAgo);
    const dow = d.getDay(); // 0 = Sun … 6 = Sat
    let w = dow === 5 ? 0.12 : dow === 6 ? 0.5 : [1.15, 1.05, 1.0, 1.0, 0.95, 1.1][dow] ?? 1.0;
    // Organic growth: the mill did more business recently than a year ago.
    w *= 0.65 + (1 - daysAgo / 365) * 0.7;
    if (monthKey(d) === slowVolumeMonth) w *= 0.35;
    days.push({ daysAgo, date: d, w });
  }
  const totalWeight = days.reduce((s, d) => s + d.w, 0);
  const cumulative: number[] = [];
  let acc = 0;
  for (const d of days) { acc += d.w; cumulative.push(acc); }
  function sampleDay(): DayBucket {
    const r = rand() * totalWeight;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    return days[lo];
  }

  const seqByYear = new Map<number, number>();
  async function nextOrderNumber(orderDate: Date): Promise<string> {
    const year = orderDate.getFullYear();
    const seq = await nextSequence(`order-${year}`);
    seqByYear.set(year, seq);
    return `ORD-${year}-${String(seq).padStart(6, "0")}`;
  }

  const labSampleMaxByYear = new Map<number, number>();
  for (const year of [TODAY.getFullYear(), TODAY.getFullYear() - 1]) {
    const latest = await LabSample.findOne({ sampleNumber: { $regex: `^LAB-${year}-` } })
      .select("sampleNumber").sort({ sampleNumber: -1 }).lean() as { sampleNumber?: string } | null;
    const m = latest?.sampleNumber?.match(/(\d+)$/);
    labSampleMaxByYear.set(year, m ? parseInt(m[1], 10) : 0);
  }
  function nextSampleNumber(sampleDate: Date): string {
    const year = sampleDate.getFullYear();
    const n = (labSampleMaxByYear.get(year) ?? 0) + 1;
    labSampleMaxByYear.set(year, n);
    return `LAB-${year}-${String(n).padStart(4, "0")}`;
  }

  const orderDocs: Record<string, unknown>[] = [];
  const sampleDocs: Record<string, unknown>[] = [];
  const tally = { open: 0, posted: 0, rejected: 0, samples: { pass: 0, warning: 0, fail: 0 } };

  for (let i = 0; i < COUNT; i++) {
    const { daysAgo, date } = sampleDay();
    const createdAt = new Date(date);
    createdAt.setHours(randInt(7, 15), randInt(0, 59), randInt(0, 59), 0);

    const mKey = monthKey(createdAt);
    const isBadQuality = mKey === badQualityMonth;
    const isToughFinance = mKey === toughFinanceMonth;

    // ── outcome ────────────────────────────────────────────────────────
    let outcome: "open" | "posted" | "rejected";
    let openStage = 0;
    let rejectStage = 0;

    if (daysAgo <= 2) {
      const r = rand();
      if (r < 0.55) { outcome = "open"; openStage = pickWeighted([{ item: 1, w: 30 }, { item: 2, w: 30 }, { item: 3, w: 25 }, { item: 4, w: 15 }]); }
      else if (r < 0.85) outcome = "posted";
      else outcome = "rejected";
    } else if (daysAgo <= 10) {
      const r = rand();
      if (r < 0.22) {
        outcome = "open";
        const reach = Math.min(7, 1 + Math.floor((daysAgo / 10) * 7));
        openStage = randInt(1, Math.max(1, reach));
      } else if (r < 0.22 + (isToughFinance ? 0.5 : 0.68)) outcome = "posted";
      else outcome = "rejected";
    } else {
      const rejectProb = isToughFinance ? 0.34 : 0.16;
      outcome = rand() < rejectProb ? "rejected" : "posted";
    }

    let rejector: { role: string; user: { _id: mongoose.Types.ObjectId; name: string } } | null = null;
    if (outcome === "rejected") {
      const weights = isToughFinance
        ? [{ item: 2, w: 6 }, { item: 3, w: 55 }, { item: 4, w: 6 }, { item: 5, w: 10 }, { item: 6, w: 4 }, { item: 7, w: 19 }]
        : [{ item: 2, w: 10 }, { item: 3, w: 32 }, { item: 4, w: 9 }, { item: 5, w: 14 }, { item: 6, w: 6 }, { item: 7, w: 29 }];
      rejectStage = pickWeighted(weights);
      // Always the stage's own role — see the header note on why.
      const role = rejectStage === 7 ? (rand() < 0.7 ? "general_manager" : "technical_manager")
        : stagesByIndex.get(rejectStage)![0].role;
      rejector = { role, user: usersByRole.get(role)! };
    }

    const terminalStage = outcome === "open" ? openStage : outcome === "rejected" ? rejectStage : 8;

    // ── customer / lines ──────────────────────────────────────────────
    const customer = pickWeighted(weightedCustomers);
    const lineCount = pickWeighted([{ item: 1, w: 70 }, { item: 2, w: 25 }, { item: 3, w: 5 }]);
    const usedProducts = new Set<string>();
    const lines: Record<string, unknown>[] = [];
    let totalBags = 0, totalWeightKg = 0;
    for (let n = 0; n < lineCount; n++) {
      let product = pickWeighted(weightedProducts);
      let guard = 0;
      while (usedProducts.has(String(product._id)) && guard++ < 8) product = pickWeighted(weightedProducts);
      usedProducts.add(String(product._id));
      const bagWeightKg = pickWeighted([
        { item: 50, w: 40 }, { item: 25, w: 25 }, { item: 30, w: 15 }, { item: 60, w: 12 }, { item: 10, w: 8 },
      ]) as (typeof BAG_WEIGHTS)[number];
      const bagCount = rand() < 0.08 ? randInt(220, 600) : randInt(15, 220);
      const lineWeightKg = bagWeightKg * bagCount;
      totalBags += bagCount; totalWeightKg += lineWeightKg;
      lines.push({
        productId: product._id, product: product.name, productAr: product.nameAr ?? "",
        bagWeightKg, bagCount, lineWeightKg, note: "",
      });
    }
    const firstProduct = products.find((p) => String(p._id) === String(lines[0].productId))!;

    // ── creator: almost always the coordinator, occasionally the manager ──
    const creatorIsManager = rand() < 0.05;
    const creator = usersByRole.get(creatorIsManager ? "sales_manager" : "sales_coordinator")!;

    // ── walk the chain, building every step with real timestamps ──────
    const steps: Record<string, unknown>[] = [];
    let cursor = createdAt;
    let currentStageIndex = 1;
    let currentStageEnteredAt = createdAt;
    let rejection: Record<string, unknown> | undefined;
    let postedAt: Date | null = null;
    let actualNetWeightKg: number | null = null, varianceKg: number | null = null, variancePct: number | null = null;
    let weighedById: mongoose.Types.ObjectId | null = null, weighedByName = "";
    let sampleActedAt: Date | null = null;

    for (let idx = 1; idx <= 8; idx++) {
      const defs = stagesByIndex.get(idx)!;
      const enteredAt = idx === 1 ? createdAt : cursor;

      if (idx === 1) {
        steps.push({
          stageKey: defs[0].key, stageIndex: 1, role: defs[0].role, kind: "create",
          status: "completed", enteredAt, actedById: creator._id, actedByName: creator.name,
          actedAt: createdAt, actedAs: "primary", actedForRole: defs[0].role, note: "",
        });
        continue;
      }

      if (idx < terminalStage || (outcome === "posted" && idx <= 8)) {
        // Passed cleanly (approved/completed).
        for (const s of defs) {
          const dur = stepDuration(s.kind);
          const actedAt = addHours(cursor, dur);
          let actedBy = usersByRole.get(s.role)!;
          let actedAs = "primary";
          // Occasionally a deputy stood in — only where one exists (stages 2-4).
          if (s.deputyRole && rand() < 0.07) {
            actedBy = usersByRole.get(s.deputyRole)!;
            actedAs = "deputy";
          }
          steps.push({
            stageKey: s.key, stageIndex: s.index, role: s.role, kind: s.kind,
            status: s.kind === "weigh" ? "completed" : "approved",
            enteredAt, actedById: actedBy._id, actedByName: actedBy.name,
            actedAt, actedAs, actedForRole: s.role, note: "",
          });
          if (s.index === 6) sampleActedAt = actedAt;
          if (s.index === 8) { weighedById = actedBy._id; weighedByName = actedBy.name; postedAt = actedAt; }
        }
        // The next stage becomes actionable the moment the LATEST of this
        // index's step(s) is acted on — matters for the dual stage 7, where
        // the two signatures don't necessarily land at the same moment.
        const lastActed = steps.filter((st) => st.stageIndex === idx).map((st) => st.actedAt as Date);
        cursor = new Date(Math.max(...lastActed.map((d) => d.getTime())));
        currentStageIndex = Math.min(idx + 1, 8);
        currentStageEnteredAt = cursor;
        continue;
      }

      if (idx === terminalStage && outcome === "rejected") {
        const reasonPool = REJECT_REASONS[idx] ?? [{ en: "Order rejected", ar: "رُفضت الطلبية" }];
        const reason = reasonPool[randInt(0, reasonPool.length - 1)];
        const rejectAt = addHours(cursor, stepDuration(defs[0].kind));
        for (const s of defs) {
          const isOwn = s.role === rejector!.role;
          steps.push({
            stageKey: s.key, stageIndex: s.index, role: s.role, kind: s.kind,
            status: isOwn ? "rejected" : "skipped",
            enteredAt, actedById: isOwn ? rejector!.user._id : null,
            actedByName: isOwn ? rejector!.user.name : "",
            actedAt: isOwn ? rejectAt : null,
            actedAs: isOwn ? "primary" : "", actedForRole: isOwn ? s.role : "",
            note: isOwn ? reason.en : "",
          });
        }
        currentStageIndex = idx;
        currentStageEnteredAt = enteredAt;
        rejection = {
          stageIndex: idx, stageKey: defs[0].key, role: rejector!.role,
          reason: reason.en, byId: rejector!.user._id, byName: rejector!.user.name, at: rejectAt,
        };
        for (let after = idx + 1; after <= 8; after++) {
          for (const s2 of stagesByIndex.get(after)!) {
            steps.push({
              stageKey: s2.key, stageIndex: s2.index, role: s2.role, kind: s2.kind,
              status: "skipped", enteredAt: null, actedById: null, actedByName: "",
              actedAt: null, actedAs: "", actedForRole: "", note: "",
            });
          }
        }
        break;
      }

      if (idx === terminalStage && outcome === "open") {
        // Still live. Stage 7's dual slots occasionally have one signature in.
        for (const s of defs) {
          const oneSigned = idx === 7 && defs.length === 2 && rand() < 0.4;
          const thisOneSigns = oneSigned && s === defs[0];
          if (thisOneSigns) {
            const actedBy = usersByRole.get(s.role)!;
            steps.push({
              stageKey: s.key, stageIndex: s.index, role: s.role, kind: s.kind,
              status: "approved", enteredAt, actedById: actedBy._id, actedByName: actedBy.name,
              actedAt: addHours(cursor, stepDuration(s.kind)), actedAs: "primary", actedForRole: s.role, note: "",
            });
          } else {
            steps.push({
              stageKey: s.key, stageIndex: s.index, role: s.role, kind: s.kind,
              status: "pending", enteredAt, actedById: null, actedByName: "",
              actedAt: null, actedAs: "", actedForRole: "", note: "",
            });
          }
        }
        currentStageIndex = idx;
        currentStageEnteredAt = enteredAt;
        for (let after = idx + 1; after <= 8; after++) {
          for (const s2 of stagesByIndex.get(after)!) {
            steps.push({
              stageKey: s2.key, stageIndex: s2.index, role: s2.role, kind: s2.kind,
              status: "pending", enteredAt: null, actedById: null, actedByName: "",
              actedAt: null, actedAs: "", actedForRole: "", note: "",
            });
          }
        }
        break;
      }
    }

    // ── lab sample, if the order reached (and passed) stage 6 ─────────
    const passedStage6 =
      (outcome === "posted") ||
      (outcome === "rejected" && rejectStage > 6) ||
      (outcome === "open" && openStage > 6);
    let labSampleId: mongoose.Types.ObjectId | null = null;
    let labOverallStatus = "";
    if (passedStage6 && sampleActedAt) {
      const statusRoll = rand();
      const failP = isBadQuality ? 0.32 : 0.09;
      const warnP = isBadQuality ? 0.28 : 0.19;
      const target = statusRoll < failP ? "fail" : statusRoll < failP + warnP ? "warning" : "pass";

      let value: number;
      if (target === "pass") value = damagedStarch.target + randFloat(-1.0, 1.0);
      else if (target === "warning") value = rand() < 0.5 ? randFloat(4.5, 4.95) : randFloat(1.55, 1.95);
      else value = rand() < 0.5 ? randFloat(5.1, 6.8) : randFloat(0.4, 1.4);
      value = Math.round(value * 100) / 100;

      const status = evaluate(value, damagedStarch.min, damagedStarch.max, damagedStarch.operator, damagedStarch.target);
      const deviation = deviationFromTarget(value, damagedStarch.target);
      const labTech = usersByRole.get("lab_technician")!;
      const sampleId = new mongoose.Types.ObjectId();
      const orderNumberPlaceholder = ""; // filled after orderNumber is known, below

      sampleDocs.push({
        _id: sampleId,
        sampleNumber: nextSampleNumber(sampleActedAt),
        orderId: null, // patched below once the order _id is known
        orderNumber: orderNumberPlaceholder,
        productId: firstProduct._id, product: firstProduct.name,
        customerId: customer._id, customer: customer.name,
        sampleDate: sampleActedAt,
        shift: pickWeighted([{ item: "morning", w: 50 }, { item: "afternoon", w: 35 }, { item: "night", w: 15 }]),
        batchId: `B-${randInt(1000, 9999)}`,
        testedById: labTech._id, testedByName: labTech.name,
        results: [{
          parameterId: damagedStarchParam._id, parameterName: "Damaged Starch", unit: "%",
          value, operator: damagedStarch.operator, min: damagedStarch.min, max: damagedStarch.max,
          target: damagedStarch.target, deviation, status,
        }],
        overallStatus: status,
        attachments: [],
        finalDecision: "pending", finalDecisionNote: "", finalDecisionById: null, finalDecisionByName: "", finalDecisionAt: null,
        notes: "", isActive: true, createdAt: sampleActedAt, updatedAt: sampleActedAt,
      });
      labSampleId = sampleId;
      labOverallStatus = status;
      tally.samples[status]++;
    }

    // ── weighbridge numbers, if posted ────────────────────────────────
    if (outcome === "posted") {
      let pct = (rand() - 0.5) * 0.7; // most loads within ±0.35%
      if (rand() < 0.06) pct = (rand() < 0.5 ? -1 : 1) * randFloat(1.2, 3.0); // an outlier
      pct = Math.round(pct * 100) / 100;
      varianceKg = Math.round(totalWeightKg * (pct / 100));
      actualNetWeightKg = totalWeightKg + varianceKg;
      variancePct = pct;
    }

    const orderNumber = await nextOrderNumber(createdAt);
    const orderId = new mongoose.Types.ObjectId();
    if (labSampleId) {
      const s = sampleDocs.find((d) => d._id === labSampleId)!;
      s.orderId = orderId; s.orderNumber = orderNumber;
    }

    orderDocs.push({
      _id: orderId,
      orderNumber, referenceNo: `DEMO-${String(i + 1).padStart(4, "0")}`,
      customerId: customer._id, customer: customer.name, customerAr: customer.nameAr ?? "",
      orderDate: createdAt, deliveryDate: null, notes: "",
      lines, totalBags, totalWeightKg,
      status: outcome === "open" ? "Pending" : outcome === "posted" ? "Posted" : "Rejected",
      currentStageIndex, currentStageEnteredAt,
      steps,
      // Omitted entirely rather than set to `undefined` for non-rejected
      // orders — relying on the driver to strip `undefined` keys is the kind
      // of thing that's fine until a connection option changes it.
      ...(rejection ? { rejection } : {}),
      labSampleIds: labSampleId ? [labSampleId] : [],
      labOverallStatus,
      actualNetWeightKg, varianceKg, variancePct,
      weighNote: "", weighedById, weighedByName,
      postedAt,
      createdById: creator._id, createdByName: creator.name,
      isActive: true,
      createdAt, updatedAt: postedAt ?? rejection?.at ?? currentStageEnteredAt,
    });
    tally[outcome]++;

    if ((i + 1) % 50 === 0) console.log(`  built ${i + 1}/${COUNT}…`);
  }

  console.log(`\nInserting ${orderDocs.length} orders and ${sampleDocs.length} lab samples…`);
  const ordersColl = mongoose.connection.collection("salesorders");
  const samplesColl = mongoose.connection.collection("labsamples");
  if (sampleDocs.length) await samplesColl.insertMany(sampleDocs, { ordered: false });
  await ordersColl.insertMany(orderDocs, { ordered: false });

  console.log("\nDone.");
  console.log(`  open (still Pending):  ${tally.open}`);
  console.log(`  posted:                ${tally.posted}`);
  console.log(`  rejected:              ${tally.rejected}`);
  console.log(`  lab samples:           pass ${tally.samples.pass} · warning ${tally.samples.warning} · fail ${tally.samples.fail}`);
  console.log(`\n  Bad-quality month:     ${badQualityMonth} (5 months ago)`);
  console.log(`  Tough-finance month:   ${toughFinanceMonth} (8 months ago)`);
  console.log(`  Slow-volume month:     ${slowVolumeMonth} (3 months ago)`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
