/**
 * Migration for the five changes of 2026-10-06, run once per database:
 *
 *   1. The product catalogue reshaped into TYPES and GRADES: a "طحين" type
 *      created and the eight existing grades moved under it, plus the four
 *      non-flour types (نخالة، جيرم، سميد، قمح), each marked as taking no lab
 *      test inside the order chain.
 *   2. The eleven existing flour parameters scoped to the "طحين" TYPE, so
 *      entering wheat tests does not put "Falling Number" on a wheat spec
 *      sheet — or wheat's own tests on every flour sheet.
 *   3. The first rejection reason, "عدم توفر البضاعة".
 *   4. `packaging: "bagged"` on every existing order line.
 *   5. `labRequired: true` on every existing order, and its stage-6 step left
 *      exactly as it is.
 *
 * Idempotent — safe to re-run. Every write is conditional on the field still
 * being absent, so a second run touches nothing and a tuned value is never
 * clobbered. Same convention as `src/scripts/seed-lab.ts`.
 *
 * Run: npm run migrate:product-catalog
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import LabProduct from "../models/LabProduct";
import LabParameter from "../models/LabParameter";
import RejectionReason from "../models/RejectionReason";
import SalesOrder from "../models/SalesOrder";

/**
 * The eight flour grades, as `seed-lab.ts` created them. Named here rather
 * than inferred as "everything that already exists", because this script's
 * whole job is to draw the line between them and the products added below —
 * and "everything that exists" stops being that line the moment it runs twice.
 */
const FLOUR_GRADES = ["WFP", "302", "305", "Bab2", "Sanabel", "Bab 1", "Fakher", "Super"];

/**
 * The type those eight are grades OF.
 *
 * It did not exist: the catalogue was a flat list of flour grades, which was
 * indistinguishable from a list of products for as long as flour was the only
 * thing in it. Adding bran and wheat to that same list put a category and a
 * grade of a category side by side as though they were the same kind of thing.
 */
const FLOUR_TYPE = { name: "Flour", nameAr: "طحين" };

/**
 * The non-flour product TYPES. Each is a type with no grades under it, which
 * makes it both the category and the thing that goes on an order line — the
 * reason types and grades share one collection. Grades can be added under any
 * of them later from the Products & Specs screen.
 *
 * `orderRequiresLabTest: false` on all four: the release test belongs to
 * flour, so an order of these skips stage 6 and goes from the Technical
 * Manager straight to the General Manager's sign-off.
 *
 * ⚠️ Wheat is on this list and is STILL lab-tested. The flag governs the order
 * chain, not the laboratory — incoming grain is sampled and scored through the
 * ordinary lab screens exactly as before. See the field's note on the model.
 */
const NEW_PRODUCTS: { name: string; nameAr: string }[] = [
  { name: "Bran",     nameAr: "نخالة" },
  { name: "Germ",     nameAr: "جيرم" },
  { name: "Semolina", nameAr: "سميد" },
  { name: "Wheat",    nameAr: "قمح" },
];

/**
 * The client's one reason, and for now the whole list. Only the system
 * administrator may add to it, from /settings.
 */
const FIRST_REJECTION_REASON = { label: "Stock not available", labelAr: "عدم توفر البضاعة", order: 1 };

// Same helper as src/scripts/seed-lab.ts::ensurePrimary() — this dev replica
// set's PRIMARY role rotates between restarts, and `directConnection=true`
// means we can land on a secondary, where reads succeed and every write fails.
async function ensurePrimary(conn: typeof mongoose) {
  try {
    const admin = conn.connection.db!.admin();
    const hello = await admin.command({ hello: 1 });
    if (!hello.isWritablePrimary && !hello.ismaster) {
      console.log("Node is secondary — attempting replSetStepUp...");
      try {
        await admin.command({ replSetStepUp: 1 });
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const h2 = await admin.command({ hello: 1 });
          if (h2.isWritablePrimary || h2.ismaster) {
            console.log("Node is now primary.");
            return;
          }
        }
        throw new Error("Node did not become primary after replSetStepUp.");
      } catch (err) {
        throw new Error(
          `Cannot write to this node (secondary) and replSetStepUp failed: ${err}\n` +
          `Try connecting to the primary replica set member directly.`
        );
      }
    }
  } catch (err) {
    if ((err as Error).message.includes("Cannot write")) throw err;
    // Standalone or hello not supported — proceed.
  }
}

async function main() {
  await connectDB();
  await ensurePrimary(mongoose);
  console.log("Connected. Migrating product catalog + order lines...\n");

  // ── 1. Existing products default to tested ──────────────────────────────
  // The schema default only applies to documents written after it existed.
  const taggedExisting = await LabProduct.updateMany(
    { orderRequiresLabTest: { $exists: false } },
    { $set: { orderRequiresLabTest: true } }
  );
  console.log(`Existing products marked as lab-tested: ${taggedExisting.modifiedCount}`);

  // ── 2. The "طحين" type, and the eight grades moved under it ─────────────
  const flourType = await LabProduct.findOneAndUpdate(
    { name: FLOUR_TYPE.name },
    {
      $setOnInsert: {
        name: FLOUR_TYPE.name, parentId: null,
        orderRequiresLabTest: true, isActive: true,
      },
      $set: { nameAr: FLOUR_TYPE.nameAr },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const flourTypeId = (flourType as unknown as { _id: mongoose.Types.ObjectId })._id;
  console.log(`Product type "${FLOUR_TYPE.nameAr}": ready`);

  /**
   * Re-parent only the grades that are still roots. A grade somebody has since
   * moved under a different type is a decision, and a migration must not
   * reopen it — which is also what makes this safe to run twice.
   */
  const reparented = await LabProduct.updateMany(
    { name: { $in: FLOUR_GRADES }, $or: [{ parentId: null }, { parentId: { $exists: false } }] },
    { $set: { parentId: flourTypeId, orderRequiresLabTest: true } }
  );
  console.log(`  grades moved under it: ${reparented.modifiedCount}`);

  // ── 3. The four non-flour product types ─────────────────────────────────
  for (const p of NEW_PRODUCTS) {
    const res = await LabProduct.findOneAndUpdate(
      { name: p.name },
      {
        // `orderRequiresLabTest` is $setOnInsert, not $set: if somebody has
        // since decided that semolina DOES need a release test, a re-run of a
        // migration must not quietly undo that. `parentId: null` likewise —
        // these are types, and one may have grown grades since.
        $setOnInsert: { name: p.name, parentId: null, orderRequiresLabTest: false, isActive: true },
        $set: { nameAr: p.nameAr },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, includeResultMetadata: true }
    );
    const created = !res.lastErrorObject?.updatedExisting;
    console.log(`  ${created ? "created" : "already present"}: ${p.name} (${p.nameAr})`);
  }

  // ── 4. Scope the existing flour parameters to the flour TYPE ────────────
  const gradeIds = (
    await LabProduct.find({ name: { $in: FLOUR_GRADES } }).select("_id").lean()
  ) as { _id: mongoose.Types.ObjectId }[];

  /**
   * Scoped to the TYPE, not to the eight grades one by one.
   *
   * "These eleven tests are the flour tests" is one statement about flour, and
   * the spec resolver matches a test scoped to a grade's parent — so one id
   * here says what eight would, and says it for the ninth grade too, the day
   * somebody adds one.
   */
  const scoped = await LabParameter.updateMany(
    { $or: [{ productIds: { $exists: false } }, { productIds: { $size: 0 } }] },
    { $set: { productIds: [flourTypeId] } }
  );
  console.log(`\nParameters scoped to "${FLOUR_TYPE.nameAr}": ${scoped.modifiedCount}`);

  /**
   * An earlier run of this script scoped them to the eight grades instead, one
   * id each. That still resolves correctly — but it leaves eight rows to
   * revisit per test whenever the grade list changes, so collapse any such set
   * back to the single type id. Matched on "every id is one of the eight", so
   * a hand-made scope that happens to include a grade is left alone.
   */
  const gradeIdStrings = new Set(gradeIds.map((g) => String(g._id)));
  const perGrade = (await LabParameter.find({ productIds: { $in: gradeIds.map((g) => g._id) } })
    .select("_id productIds name")
    .lean()) as { _id: mongoose.Types.ObjectId; productIds: unknown[]; name: string }[];

  let collapsed = 0;
  for (const param of perGrade) {
    const ids = (param.productIds ?? []).map(String);
    if (!ids.length || !ids.every((x) => gradeIdStrings.has(x))) continue;
    await LabParameter.updateOne({ _id: param._id }, { $set: { productIds: [flourTypeId] } });
    collapsed++;
  }
  if (collapsed) console.log(`Parameters collapsed from per-grade to the type: ${collapsed}`);

  console.log(
    "  Wheat's own tests can now be added from Lab → Products & Specs → Add parameter,\n" +
    "  ticking only قمح under \"Applies to\"."
  );

  // ── 5. The first rejection reason ───────────────────────────────────────
  const reasonRes = await RejectionReason.findOneAndUpdate(
    { label: FIRST_REJECTION_REASON.label },
    {
      $setOnInsert: {
        label: FIRST_REJECTION_REASON.label,
        order: FIRST_REJECTION_REASON.order,
        isActive: true,
      },
      $set: { labelAr: FIRST_REJECTION_REASON.labelAr },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, includeResultMetadata: true }
  );
  console.log(
    `\nRejection reason "${FIRST_REJECTION_REASON.labelAr}": ` +
    `${reasonRes.lastErrorObject?.updatedExisting ? "already present" : "created"}`
  );

  // ── 6. Existing orders: bagged lines, lab required ──────────────────────
  /**
   * Every order that predates this work is a bagged flour order. Both writes
   * assert the field is still absent, so neither can touch an order raised
   * after the change — and in particular `labRequired: true` can never be
   * written over an untested order, whose stage-6 step is `skipped` and whose
   * route would then be describing a lab stage that is closed.
   */
  const labBackfill = await SalesOrder.updateMany(
    { labRequired: { $exists: false } },
    { $set: { labRequired: true } }
  );
  console.log(`Orders marked as lab-required: ${labBackfill.modifiedCount}`);

  // `lines.$[].packaging` — the positional-all operator, so one statement
  // covers every line of every order rather than a read-modify-write loop.
  const packagingBackfill = await SalesOrder.updateMany(
    { "lines.packaging": { $exists: false } },
    { $set: { "lines.$[l].packaging": "bagged" } },
    { arrayFilters: [{ "l.packaging": { $exists: false } }] }
  );
  console.log(`Orders with lines marked as bagged: ${packagingBackfill.modifiedCount}`);

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
