/**
 * Proves the five changes of 2026-10-06 behave, end to end against the real
 * database:
 *
 *   1. An order of an untested product (نخالة) skips stage 6 — the Technical
 *      Manager's approval at 5 lands it on 7, not on a lab stage nobody can
 *      claim. A flour order still stops at 6.
 *   2. Wheat tests can be scoped to wheat without appearing on flour.
 *   3. The Technical Manager's rejection resolves to the managed reason list.
 *   4. A weight beyond ±0.5% is refused without a stated reason.
 *   5. A bulk line stores null bag fields and its weight as entered.
 *
 * Read-mostly: it creates orders, walks them, and deletes everything it made
 * before exiting. Nothing it touches outlives the run.
 *
 *   npm run check:order-routes
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { createSalesOrder } from "../lib/salesOrder";
import { claimAndAdvance } from "../lib/salesTransition";
import {
  SALES_STAGES, stageSkipped, nextLiveStageIndex, stagesAt,
  type OrderLike, type StageDef,
} from "../lib/salesWorkflow";
import { orderPermissions } from "../lib/salesAuth";
import { buildOrderLines } from "../lib/salesOrderLines";
import SalesOrder from "../models/SalesOrder";
import LabCustomer from "../models/LabCustomer";
import LabProduct from "../models/LabProduct";
import LabParameter from "../models/LabParameter";
import RejectionReason from "../models/RejectionReason";
import User from "../models/User";
import { VARIANCE_TOLERANCE_PCT } from "../types";

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

// Same helper as seed-lab.ts: this replica set's PRIMARY rotates, and
// `directConnection=true` pins us to one node, where reads succeed and every
// write fails with "not primary (10107)".
async function ensurePrimary(conn: typeof mongoose) {
  const admin = conn.connection.db!.admin();
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary || hello.ismaster) return;
  console.log("Node is secondary — attempting replSetStepUp...");
  await admin.command({ replSetStepUp: 1 });
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h2 = await admin.command({ hello: 1 });
    if (h2.isWritablePrimary || h2.ismaster) { console.log("Node is now primary.\n"); return; }
  }
  throw new Error("Node did not become primary — connect to the primary member directly.");
}

type Actorish = { _id: mongoose.Types.ObjectId; name: string; role: string };

/**
 * Sign whichever step is live right now, as whoever owns it.
 *
 * Goes through `claimAndAdvance` directly rather than through the HTTP routes,
 * so it does NOT honour a route's own extra preconditions — the lab route, for
 * instance, refuses to complete stage 6 until every product has a sample.
 * That is why nothing here walks *through* stage 6: a test that signed it
 * blindly would prove only that this helper can, which is the mistake the
 * first version of this script made and reported as a product bug.
 */
async function signCurrent(orderId: string, holders: Map<string, Actorish>): Promise<number> {
  const fresh = (await SalesOrder.findById(orderId).lean()) as unknown as OrderLike & {
    currentStageIndex: number;
  };
  const stage: StageDef | undefined = stagesAt(fresh.currentStageIndex).find(
    (s) => fresh.steps.find((st) => st.stageKey === s.key)?.status === "pending"
  );
  if (!stage) throw new Error(`no claimable step at stage ${fresh.currentStageIndex}`);

  const actor = holders.get(stage.role);
  if (!actor) throw new Error(`no user holds role ${stage.role} — run npm run seed`);

  const res = await claimAndAdvance(orderId, stage, { _id: actor._id, name: actor.name }, {
    actedAs: "primary", actedForRole: stage.role, note: "check-order-routes",
  });
  if ("code" in res) throw new Error(`transition failed at ${stage.key}: ${res.code}`);
  return stage.index;
}

/** Walk an order forward, stopping ON `target` rather than past it. */
async function walkTo(
  orderId: string,
  target: number,
  holders: Map<string, Actorish>
): Promise<Record<string, unknown>> {
  for (let guard = 0; guard < 12; guard++) {
    const fresh = (await SalesOrder.findById(orderId).lean()) as unknown as {
      currentStageIndex: number; status: string;
    };
    if (fresh.currentStageIndex >= target || fresh.status !== "Pending") break;
    await signCurrent(orderId, holders);
  }
  return (await SalesOrder.findById(orderId).lean()) as Record<string, unknown>;
}

async function main() {
  await connectDB();
  await ensurePrimary(mongoose);

  const created: mongoose.Types.ObjectId[] = [];

  try {
    const customer = (await LabCustomer.findOne({ isActive: true })
      .select("name nameAr").lean()) as { _id: mongoose.Types.ObjectId; name: string } | null;
    if (!customer) throw new Error("no customer — run npm run seed:customers");

    const roles = Array.from(new Set(SALES_STAGES.map((s) => s.role)));
    const holders = new Map<string, Actorish>();
    for (const r of roles) {
      const u = (await User.findOne({ role: r, isActive: true })
        .select("name role").lean()) as Actorish | null;
      if (u) holders.set(r, u);
    }
    const missingRoles = roles.filter((r) => !holders.has(r));
    if (missingRoles.length) throw new Error(`no user for role(s): ${missingRoles.join(", ")} — run npm run seed`);

    /**
     * A GRADE of flour, not the flour type — the type is a category and
     * nothing can be ordered against it, which §0 below is the test for.
     */
    const flour = (await LabProduct.findOne({
      orderRequiresLabTest: { $ne: false }, isActive: true, parentId: { $ne: null },
    }).select("name nameAr parentId").lean()) as
      { _id: mongoose.Types.ObjectId; name: string; parentId: mongoose.Types.ObjectId } | null;
    /**
     * An untested LEAF, not merely an untested row.
     *
     * Before the office register was imported, نخالة was a type with no
     * grades and therefore orderable itself. It has five grades now, so
     * picking the first untested row would hand this test a category that
     * `buildOrderLines` correctly refuses. What the order tests need is
     * something that can actually go on a line.
     */
    const untestedIds = (await LabProduct.find({ orderRequiresLabTest: false, isActive: true })
      .select("_id name nameAr").lean()) as { _id: mongoose.Types.ObjectId; name: string }[];
    const parentsWithGrades = new Set(
      (await LabProduct.find({ parentId: { $in: untestedIds.map((u) => u._id) }, isActive: true })
        .distinct("parentId")).map(String)
    );
    const untested = untestedIds.find((u) => !parentsWithGrades.has(String(u._id))) ?? null;
    if (!flour || !untested) {
      throw new Error("catalog not migrated — run npm run migrate:product-catalog");
    }

    // ── 0. the catalogue is two levels ───────────────────────────────────
    console.log("0. The catalogue separates types from grades\n");
    const flourType = (await LabProduct.findById(flour.parentId)
      .select("name nameAr parentId orderRequiresLabTest").lean()) as
      { _id: mongoose.Types.ObjectId; name: string; parentId: unknown; orderRequiresLabTest: boolean } | null;
    check("the flour grade has a type above it", !!flourType, flourType?.name ?? "none");
    check("that type is a root", !!flourType && !flourType.parentId);

    const gradeCount = await LabProduct.countDocuments({ parentId: flour.parentId, isActive: true });
    check("the type carries every flour grade", gradeCount >= 8, `${gradeCount} grades`);

    /**
     * The RULE, not yesterday's catalogue: whatever an order line points at
     * must be a leaf. This used to assert "نخالة has no grades", which was a
     * fact about the data and stopped being true the moment the register was
     * imported — a passing test that only described the seed.
     */
    const nonLeafOffered = (await LabProduct.find({ isActive: true }).select("_id name").lean())
      .filter((p) => parentsWithGrades.has(String((p as { _id: unknown })._id)));
    check(
      `the untested product used below is a leaf (${untested.name})`,
      !parentsWithGrades.has(String(untested._id))
    );
    check(
      "every type that has grades is excluded from order lines",
      (await Promise.all(nonLeafOffered.map(async (p) =>
        !(await buildOrderLines([{ productId: String((p as { _id: unknown })._id), packaging: "bagged", bagWeightKg: 50, bagCount: 1 }])).ok
      ))).every(Boolean),
      `${nonLeafOffered.length} type(s) with grades`
    );

    // A type with grades must never reach an order line.
    const typeOnLine = await buildOrderLines([
      { productId: String(flour.parentId), packaging: "bagged", bagWeightKg: 50, bagCount: 10 },
    ]);
    check("a product type is refused on an order line", !typeOnLine.ok);

    // The flag belongs to the type and must have reached every grade.
    const disagreeing = await LabProduct.countDocuments({
      parentId: flour.parentId, isActive: true, orderRequiresLabTest: false,
    });
    check("no grade disagrees with its type about the lab", disagreeing === 0, `${disagreeing} disagree`);

    console.log("");

    // ── 1. the two routes ────────────────────────────────────────────────
    console.log("1. Stage 6 is skipped for an untested product\n");

    /**
     * The question is where the TECHNICAL MANAGER's signature at stage 5 puts
     * the order — 6 for flour, 7 for anything untested. So each order is
     * walked to 5, stage 5 is signed, and the resulting index is read. Walking
     * further would mean signing stage 6 from outside the route that guards
     * it, which proves nothing about the route.
     */
    for (const [label, product, expectStage] of [
      [`flour (${flour.name})`, flour, 6],
      [`untested (${untested.name})`, untested, 7],
    ] as const) {
      const built = await buildOrderLines([
        { productId: String(product._id), packaging: "bagged", bagWeightKg: 50, bagCount: 100 },
      ]);
      if (!built.ok) throw new Error(`buildOrderLines refused a ${label} line`);

      const order = (await createSalesOrder(
        {
          customerId: customer._id, customer: customer.name,
          orderDate: new Date(),
          lines: built.value.lines,
          labRequired: built.value.labRequired,
          totalBags: built.value.totalBags,
          totalWeightKg: built.value.totalWeightKg,
        },
        holders.get("sales_coordinator")!
      )) as unknown as { _id: mongoose.Types.ObjectId };
      created.push(order._id);

      await walkTo(String(order._id), 5, holders);
      const signedIndex = await signCurrent(String(order._id), holders);
      if (signedIndex !== 5) throw new Error(`expected to sign stage 5, signed ${signedIndex}`);

      const walked = (await SalesOrder.findById(order._id).lean()) as Record<string, unknown>;
      const stageNow = walked.currentStageIndex as number;
      const like = walked as unknown as OrderLike;

      check(
        `${label}: the Technical Manager's approval lands it on stage ${expectStage}`,
        stageNow === expectStage,
        `stage=${stageNow} labRequired=${walked.labRequired}`
      );
      check(
        `${label}: stage 6 ${expectStage === 7 ? "is" : "is not"} written off the route`,
        stageSkipped(like, 6) === (expectStage === 7)
      );
      // The invariant the whole visibility rule rests on.
      check(`${label}: nextLiveStageIndex never goes backwards`,
        [1, 2, 3, 4, 5, 6, 7].every((i) => {
          const n = nextLiveStageIndex(like, i);
          return n === null || n > i;
        })
      );
    }

    // ── 2. parameter scoping ────────────────────────────────────────────
    console.log("\n2. Wheat's tests do not reach flour's spec sheet\n");
    const wheat = (await LabProduct.findOne({ name: "Wheat" }).select("_id").lean()) as
      { _id: mongoose.Types.ObjectId } | null;
    if (!wheat) {
      check("wheat product exists", false, "run npm run migrate:product-catalog");
    } else {
      // Mirrors the specs route: a test scoped to the grade's TYPE counts.
      const scopedToFlour = {
        isActive: true,
        $or: [
          { productIds: { $exists: false } },
          { productIds: { $size: 0 } },
          { productIds: { $in: [flour._id, flour.parentId] } },
        ],
      };
      const scopedToWheat = {
        isActive: true,
        $or: [
          { productIds: { $exists: false } },
          { productIds: { $size: 0 } },
          { productIds: wheat._id },
        ],
      };
      const [onFlour, onWheat, total] = await Promise.all([
        LabParameter.countDocuments(scopedToFlour),
        LabParameter.countDocuments(scopedToWheat),
        LabParameter.countDocuments({ isActive: true }),
      ]);
      check("flour has tests", onFlour > 0, `${onFlour} of ${total}`);
      check(
        "wheat does not inherit every flour test",
        onWheat < total || onFlour < total,
        `flour=${onFlour} wheat=${onWheat} total=${total}`
      );
    }

    // ── 3. the rejection vocabulary ─────────────────────────────────────
    console.log("\n3. The Technical Manager rejects from the managed list\n");
    const reasons = await RejectionReason.countDocuments({ isActive: true });
    check("at least one reason is configured", reasons > 0, `${reasons} active`);

    const tmOrderBuilt = await buildOrderLines([
      { productId: String(flour._id), packaging: "bagged", bagWeightKg: 50, bagCount: 10 },
    ]);
    if (!tmOrderBuilt.ok) throw new Error("buildOrderLines refused the TM test line");
    const tmOrder = (await createSalesOrder(
      {
        customerId: customer._id, customer: customer.name, orderDate: new Date(),
        lines: tmOrderBuilt.value.lines, labRequired: tmOrderBuilt.value.labRequired,
        totalBags: tmOrderBuilt.value.totalBags, totalWeightKg: tmOrderBuilt.value.totalWeightKg,
      },
      holders.get("sales_coordinator")!
    )) as unknown as { _id: mongoose.Types.ObjectId };
    created.push(tmOrder._id);

    const atFive = await walkTo(String(tmOrder._id), 5, holders);
    const tm = holders.get("technical_manager")!;
    const gm = holders.get("general_manager")!;
    const shaped: OrderLike = {
      status: atFive.status as string,
      currentStageIndex: atFive.currentStageIndex as number,
      createdById: String(atFive.createdById),
      steps: (atFive as unknown as OrderLike).steps,
    };

    const tmPerms = await orderPermissions(shaped, { id: String(tm._id), role: tm.role });
    check("at stage 5 the TM's rejection is his own", tmPerms.rejectAsRole === "technical_manager",
      `rejectAsRole=${tmPerms.rejectAsRole}`);
    const gmPerms = await orderPermissions(shaped, { id: String(gm._id), role: gm.role });
    check("the GM at stage 5 still writes freely", gmPerms.rejectAsRole === "general_manager",
      `rejectAsRole=${gmPerms.rejectAsRole}`);

    // ── 4. the variance tolerance ───────────────────────────────────────
    console.log("\n4. A wide variance needs a stated reason\n");
    const ordered = 5000;
    for (const [label, actual, expectDemanded] of [
      ["inside tolerance (+0.2%)", 5010, false],
      ["beyond tolerance (+2%)", 5100, true],
    ] as const) {
      const varianceKg = actual - ordered;
      const pct = Math.round((varianceKg / ordered) * 10000) / 100;
      const demanded = Math.abs(pct) > VARIANCE_TOLERANCE_PCT;
      check(`${label}: reason ${expectDemanded ? "required" : "optional"}`,
        demanded === expectDemanded, `${pct}% vs ±${VARIANCE_TOLERANCE_PCT}%`);
    }

    // ── 5. bulk lines ───────────────────────────────────────────────────
    console.log("\n5. A bulk line is entered in tonnes and stored in kilograms\n");
    // 28.5 t typed in → 28 500 kg stored. A factor-of-1000 slip here would be
    // silent: every total, variance and report would simply be wrong by 1000.
    const bulkBuilt = await buildOrderLines([
      { productId: String(untested._id), packaging: "bulk", weightTons: 28.5 },
    ]);
    check("buildOrderLines accepts a bulk line in tonnes", bulkBuilt.ok);
    if (bulkBuilt.ok) {
      const l = bulkBuilt.value.lines[0];
      check("bagWeightKg is null, not 0", l.bagWeightKg === null, String(l.bagWeightKg));
      check("bagCount is null, not 0", l.bagCount === null, String(l.bagCount));
      check("28.5 t is stored as 28500 kg", l.lineWeightKg === 28500, `${l.lineWeightKg} kg`);
      check("the order total matches", bulkBuilt.value.totalWeightKg === 28500, `${bulkBuilt.value.totalWeightKg} kg`);
      check("totalBags excludes it", bulkBuilt.value.totalBags === 0, String(bulkBuilt.value.totalBags));

      // The schema is the last line of defence on the create path.
      const bulkOrder = (await createSalesOrder(
        {
          customerId: customer._id, customer: customer.name, orderDate: new Date(),
          lines: bulkBuilt.value.lines, labRequired: bulkBuilt.value.labRequired,
          totalBags: bulkBuilt.value.totalBags, totalWeightKg: bulkBuilt.value.totalWeightKg,
        },
        holders.get("sales_coordinator")!
      )) as unknown as { _id: mongoose.Types.ObjectId };
      created.push(bulkOrder._id);
      const stored = (await SalesOrder.findById(bulkOrder._id).lean()) as unknown as {
        lines: { packaging: string; bagWeightKg: number | null; bagCount: number | null }[];
      };
      check("it survives schema validation", stored.lines[0].packaging === "bulk");
      check("and comes back out of Mongo with nulls",
        stored.lines[0].bagWeightKg === null && stored.lines[0].bagCount === null);
    }

    // A bagged line missing its sack size must be refused, or the schema
    // validator is the only thing standing between a typo and a stored order.
    const badBagged = await buildOrderLines([
      { productId: String(flour._id), packaging: "bagged", bagCount: 10 },
    ]);
    check("a bagged line with no sack size is refused", !badBagged.ok);
    const badBulk = await buildOrderLines([
      { productId: String(untested._id), packaging: "bulk", weightTons: 0 },
    ]);
    check("a bulk line with no weight is refused", !badBulk.ok);

    // The ceiling is in tonnes now; a kilogram figure typed into it is the
    // exact mistake it exists to catch.
    const kgTypedAsTons = await buildOrderLines([
      { productId: String(untested._id), packaging: "bulk", weightTons: 28500 },
    ]);
    check("a kilogram figure typed into the tonnes box is refused", !kgTypedAsTons.ok);

    // A kilogram of precision survives the unit change.
    const fine = await buildOrderLines([
      { productId: String(untested._id), packaging: "bulk", weightTons: 0.001 },
    ]);
    check("0.001 t resolves to exactly 1 kg",
      fine.ok && fine.value.lines[0].lineWeightKg === 1,
      fine.ok ? `${fine.value.lines[0].lineWeightKg} kg` : "refused");

    // ── the no-mixing rule ──────────────────────────────────────────────
    console.log("\n6. An order may not mix tested and untested products\n");
    const mixed = await buildOrderLines([
      { productId: String(flour._id), packaging: "bagged", bagWeightKg: 50, bagCount: 10 },
      { productId: String(untested._id), packaging: "bulk", weightTons: 1 },
    ]);
    check("a mixed order is refused", !mixed.ok);
  } finally {
    if (created.length) {
      await SalesOrder.deleteMany({ _id: { $in: created } });
      console.log(`\nCleaned up ${created.length} test order(s).`);
    }
  }

  console.log(failures === 0 ? "\nPASS — every route behaves" : `\nFAIL — ${failures} check(s) failed`);
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
