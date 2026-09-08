/**
 * Seed the Lab / Quality module's catalog: flour products, quality
 * parameters (with default limits), and per-product threshold overrides —
 * transcribed directly from the QA department's "سستم امختبر" PDF.
 *
 * Idempotent — safe to re-run anytime (upserts keyed on `name`, same
 * convention as src/scripts/seed.ts).
 *
 * Run: npm run seed:lab
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import LabProduct from "../models/LabProduct";
import LabParameter from "../models/LabParameter";
import LabParameterThreshold from "../models/LabParameterThreshold";

// Reads MONGODB_URI via the shared connection helper. The CMMS version
// hardcoded its connection string, which on a new server silently seeds the
// wrong database (SPEC §5).

// ── 8 flour grades ───────────────────────────────────────────────────────────
// The grade names are what the plant actually calls them. Numeric codes have no
// translation; the rest are Arabic brand names that the CMMS only ever stored
// transliterated.
const PRODUCTS: { name: string; nameAr: string }[] = [
  { name: "WFP",     nameAr: "" },
  { name: "302",     nameAr: "" },
  { name: "305",     nameAr: "" },
  { name: "Bab2",    nameAr: "باب ٢" },
  { name: "Sanabel", nameAr: "سنابل" },
  { name: "Bab 1",   nameAr: "باب ١" },
  { name: "Fakher",  nameAr: "فاخر" },
  { name: "Super",   nameAr: "سوبر" },
];

// ── 11 quality parameters, plant-wide defaults from the Tests/Limits table.
// `defaultTarget` (the recommended value) is NOT in the QA PDF — that only
// gives pass/fail limits — so it's left null here for QA to fill in per
// product from the Products & Specs screen. Only Damaged Starch, which the
// PDF states as a true range, gets an obvious midpoint target.
type Operator = "n_m_t" | "n_l_t" | "range" | "none";
const PARAMETERS: {
  name: string; nameAr: string; unit: string; operator: Operator;
  defaultMin: number | null; defaultMax: number | null; defaultTarget: number | null; order: number;
}[] = [
  { name: "Moisture", nameAr: "الرطوبة",         unit: "%",      operator: "n_m_t", defaultMin: null, defaultMax: 14.0, defaultTarget: null, order: 1 },
  { name: "Protein", nameAr: "البروتين",          unit: "%",      operator: "n_l_t", defaultMin: 11.0, defaultMax: null, defaultTarget: null, order: 2 },
  { name: "Wet Gluten", nameAr: "الغلوتين الرطب",       unit: "%",      operator: "n_l_t", defaultMin: 24.0, defaultMax: null, defaultTarget: null, order: 3 },
  { name: "Gluten Index", nameAr: "مؤشر الغلوتين",     unit: "%",      operator: "n_l_t", defaultMin: 85,   defaultMax: null, defaultTarget: null, order: 4 },
  { name: "Falling Number", nameAr: "رقم السقوط",   unit: "sec",    operator: "n_l_t", defaultMin: 260,  defaultMax: null, defaultTarget: null, order: 5 },
  { name: "Water Absorption", nameAr: "امتصاص الماء", unit: "%",      operator: "n_l_t", defaultMin: 55.0, defaultMax: null, defaultTarget: null, order: 6 },
  { name: "Ash", nameAr: "الرماد",              unit: "%",      operator: "n_m_t", defaultMin: null, defaultMax: 0.65, defaultTarget: null, order: 7 },
  { name: "Zeleny", nameAr: "زيليني",           unit: "ml",     operator: "n_l_t", defaultMin: 26.0, defaultMax: null, defaultTarget: null, order: 8 },
  { name: "Damaged Starch", nameAr: "النشا المتضرر",   unit: "%",      operator: "range", defaultMin: 1.5,  defaultMax: 5.0,  defaultTarget: 3.25, order: 9 },
  { name: "Color L*", nameAr: "اللون *L",         unit: "L*",     operator: "none",  defaultMin: null, defaultMax: null, defaultTarget: null, order: 10 },
  { name: "W", nameAr: "الطاقة (W)",                unit: "10e-4J", operator: "n_l_t", defaultMin: 200,  defaultMax: null, defaultTarget: null, order: 11 },
];

// ── Ash% varies by product — the one exception the PDF calls out explicitly.
// WFP is genuinely single-sided (N.M.T 0.65, no floor) so it stays "n_m_t";
// every other product is a real two-sided band (e.g. Bab2: 0.80–1.30), so it
// must override the operator to "range" too — otherwise a value below the
// stated minimum would incorrectly pass under the parameter's default
// "not more than" rule (only checks the ceiling).
// `target` = the midpoint of each band. The QA PDF states only the accepted
// range, but the QC workbook's Target is consistently the band midpoint
// (e.g. Ash 0.45–0.65 → target 0.55), so that's the starting value here —
// QA can tune any of these per product from the Products & Specs screen.
const mid = (a: number, b: number) => Math.round(((a + b) / 2) * 1000) / 1000;

const ASH_OVERRIDES: Record<string, { min: number | null; max: number | null; target: number | null; operator: Operator }> = {
  WFP:      { min: null, max: 0.65, target: null,            operator: "n_m_t" },
  "302":    { min: 0.60, max: 0.64, target: mid(0.60, 0.64), operator: "range" },
  "305":    { min: 0.55, max: 0.59, target: mid(0.55, 0.59), operator: "range" },
  Bab2:     { min: 0.80, max: 1.30, target: mid(0.80, 1.30), operator: "range" },
  Sanabel:  { min: 0.60, max: 0.64, target: mid(0.60, 0.64), operator: "range" },
  "Bab 1":  { min: 0.57, max: 0.60, target: mid(0.57, 0.60), operator: "range" },
  Fakher:   { min: 0.52, max: 0.54, target: mid(0.52, 0.54), operator: "range" },
  Super:    { min: 0.50, max: 0.52, target: mid(0.50, 0.52), operator: "range" },
};

// If connected to a replica-set secondary, promote it to primary and wait —
// this dev replica set's PRIMARY role rotates between restarts, and
// directConnection=true means we can land on a secondary. Same helper as
// src/scripts/seed.ts::ensurePrimary().
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
    // Standalone or hello not supported — proceed
  }
}

async function main() {
  await connectDB();
  await ensurePrimary(mongoose);
  console.log("Connected. Seeding Lab / Quality catalog...\n");

  // ── Products ────────────────────────────────────────────────────────────
  let productsCreated = 0;
  const productIdByName = new Map<string, mongoose.Types.ObjectId>();
  for (const p of PRODUCTS) {
    const res = await LabProduct.findOneAndUpdate(
      { name: p.name },
      {
        $setOnInsert: { name: p.name, isActive: true },
        // Like the parameters: the Arabic label is a translation, so it syncs on
        // every run rather than only on insert.
        $set: { nameAr: p.nameAr },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    productIdByName.set(p.name, res._id as mongoose.Types.ObjectId);
    productsCreated++;
  }
  console.log(`Products: ${productsCreated} upserted (${PRODUCTS.map((p) => p.name).join(", ")})`);

  // ── Parameters ──────────────────────────────────────────────────────────
  let parametersCreated = 0;
  const parameterIdByName = new Map<string, mongoose.Types.ObjectId>();
  for (const p of PARAMETERS) {
    const res = await LabParameter.findOneAndUpdate(
      { name: p.name },
      {
        // Limits are $setOnInsert only: a re-run must never clobber a threshold
        // QA has since tuned from the Products & Specs screen.
        $setOnInsert: {
          name: p.name, unit: p.unit, operator: p.operator,
          defaultMin: p.defaultMin, defaultMax: p.defaultMax, defaultTarget: p.defaultTarget,
          order: p.order, isActive: true,
        },
        // The Arabic label is a translation, not a tuned value — it should
        // reach existing rows too, so $set. (Mongo forbids the same field in
        // both operators, which is why nameAr appears only here.)
        $set: { nameAr: p.nameAr },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    parameterIdByName.set(p.name, res._id as mongoose.Types.ObjectId);
    parametersCreated++;

    // `$setOnInsert` above only fires for brand-new docs, so parameters that
    // already existed before `defaultTarget` was introduced would never get
    // it. Backfill it with an aggregation-pipeline update that writes only
    // when the field is still empty — never overwriting a value QA has set.
    if (p.defaultTarget != null) {
      await LabParameter.updateOne(
        { _id: res._id },
        [{ $set: { defaultTarget: { $ifNull: ["$defaultTarget", p.defaultTarget] } } }],
        { updatePipeline: true } // Mongoose requires this opt-in for pipeline updates
      );
    }
  }
  console.log(`Parameters: ${parametersCreated} upserted`);

  // ── Ash% per-product threshold overrides ───────────────────────────────
  const ashId = parameterIdByName.get("Ash");
  let ashOverridesCreated = 0;
  if (ashId) {
    for (const [productName, { min, max, target, operator }] of Object.entries(ASH_OVERRIDES)) {
      const productId = productIdByName.get(productName);
      if (!productId) continue;
      await LabParameterThreshold.findOneAndUpdate(
        { parameterId: ashId, productId },
        { $set: { parameterId: ashId, productId, min, max, target, operator, isActive: true } },
        { upsert: true }
      );
      ashOverridesCreated++;
    }
  }
  console.log(`Ash% threshold overrides: ${ashOverridesCreated} upserted`);

  // ── Moisture% has no defined limit for product "Bab 1" (the PDF's
  //    "B1 Moisture% ------") — same override mechanism, operator "none" ──
  const moistureId = parameterIdByName.get("Moisture");
  const bab1Id = productIdByName.get("Bab 1");
  if (moistureId && bab1Id) {
    await LabParameterThreshold.findOneAndUpdate(
      { parameterId: moistureId, productId: bab1Id },
      { $setOnInsert: { parameterId: moistureId, productId: bab1Id, min: null, max: null, target: null, operator: "none", isActive: true } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    console.log("Moisture% override for Bab 1 (no limit): upserted");
  }

  console.log("\n✅  Lab seed complete. Safe to re-run anytime.");
  await mongoose.disconnect();
}

main().catch(console.error);
