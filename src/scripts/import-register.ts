/**
 * Import the office's register — the customers and the product catalogue —
 * from `attachments/الاسماء والمخابز .xlsm`.
 *
 * Two sheets, two jobs:
 *
 *   اسماء التجار   351 customers, each with a number, a city, a sales rep,
 *                  an account-opening date and sometimes an ID number. The
 *                  cities become their own collection and the customer points
 *                  at a row in it, so reports can group by city.
 *
 *   اسماء الاصناف  70 rows that are really 27 PRODUCTS at different pack
 *                  sizes: "طحين زهرة -1- كغم", "طحين زهرة  30 كغم" and two
 *                  more are one product. Size is not part of a product here —
 *                  an order line carries its own `bagWeightKg` — so the size
 *                  is stripped and the rows collapse by base name.
 *
 * Idempotent: re-running updates in place and creates nothing twice.
 *
 * Run: npm run import:register            (add --dry to see the plan only)
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import XLSX from "xlsx";
import { connectDB } from "../lib/mongoose";
import { normalizeName } from "../lib/apiHelpers";
import City from "../models/City";
import LabCustomer from "../models/LabCustomer";
import LabProduct from "../models/LabProduct";

const FILE = path.join(process.cwd(), "attachments", "الاسماء والمخابز .xlsm");
const SHEET_CUSTOMERS = "اسماء التجار ";
const SHEET_PRODUCTS = "اسماء الاصناف ";
const DRY = process.argv.includes("--dry");

/**
 * Which product TYPE a base name belongs to, by its first word.
 *
 * Checked longest-first so "نخالة" cannot be mistaken for a flour. A name
 * matching nothing is reported rather than filed under a guess — a product in
 * the wrong type gets the wrong lab rule, which is a stage of the approval
 * chain, not a label.
 */
const TYPE_BY_PREFIX: [prefix: string, typeName: string][] = [
  ["نخالة", "Bran"],
  ["سميد", "Semolina"],
  ["جنين القمح", "Germ"],
  ["جيرم", "Germ"],
  ["طحين", "Flour"],
];

/**
 * Existing grades renamed rather than replaced, so their orders, samples and
 * threshold overrides stay attached — the `_id` never moves.
 *
 * 302 and 305 have no counterpart in the register. They are archived, not
 * renamed onto an arbitrary row: a demo order claiming to be a product it
 * never was is worse than one pointing at an archived grade, and archiving is
 * what the flag is for.
 */
const RENAME: Record<string, string> = {
  Super: "طحين السوبر",
  Sanabel: "طحين سنابل",
  "Bab 1": "طحين ذهبي باب اول",
  Bab2: "طحين ذهبي باب ثاني",
  Fakher: "طحين ابيض فاخر",
  WFP: "طحين عطاءات W.F.P",
};
const ARCHIVE = ["302", "305"];

/**
 * Strip a trailing pack size: an optional "شوال", a number, and a unit, with
 * any mix of dashes and spaces between them.
 *
 * Anchored to the END of the string on purpose. A dash INSIDE a name is part
 * of the name — "جنين القمح - جيرم" must survive whole — so this never splits
 * on a separator, only on a separator that is followed by a size and then the
 * end.
 */
const UNIT = "(?:كغم|كجم|كيلو|K\\.?G|kg)";
const SIZE_RE = new RegExp(`[\\s\\-]*(?:شوال)?[\\s\\-]*(\\d{1,3})[\\s\\-]*${UNIT}\\s*$`, "i");

function baseName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  const m = name.match(SIZE_RE);
  if (!m) return name;
  return name.slice(0, m.index).replace(/[\s\-]+$/, "").trim();
}

/**
 * Two rows in the register differ from their siblings by a typo — a missing
 * space and a dash for a space — which would otherwise create two products
 * where the office has one.
 */
const SPELLING_FIXES: Record<string, string> = {
  "طحين ذهبي زيرواكسترا": "طحين ذهبي زيرو اكسترا",
  "طحين ذهبي-زيرو": "طحين ذهبي زيرو",
};

/** Excel keeps dates as days since 1899-12-30. */
const excelDate = (serial: unknown): Date | null => {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
};

const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

async function main() {
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`);
  await connectDB();
  console.log(`Reading ${path.basename(FILE)}${DRY ? "  (dry run — nothing is written)" : ""}\n`);

  const wb = XLSX.readFile(FILE);
  const rowsOf = (name: string) =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null }) as unknown[][];

  // ── Cities ──────────────────────────────────────────────────────────────
  const custRows = rowsOf(SHEET_CUSTOMERS).slice(1).filter((r) => cell(r[1]) || cell(r[2]));
  const cityNames = Array.from(new Set(custRows.map((r) => cell(r[3])).filter(Boolean))).sort();

  const cityIdByName = new Map<string, mongoose.Types.ObjectId>();
  let citiesCreated = 0;
  for (const name of cityNames) {
    const nameKey = normalizeName(name);
    const existing = (await City.findOne({ nameKey }).lean()) as { _id: mongoose.Types.ObjectId } | null;
    if (existing) {
      cityIdByName.set(name, existing._id);
      continue;
    }
    citiesCreated++;
    if (DRY) continue;
    // The Arabic goes in BOTH fields — see the note on the City model.
    const made = await City.create({ name, nameKey, nameAr: name, isActive: true });
    cityIdByName.set(name, (made as unknown as { _id: mongoose.Types.ObjectId })._id);
  }
  console.log(`Cities: ${cityNames.length} in the register, ${citiesCreated} created`);

  // ── Customers ───────────────────────────────────────────────────────────
  let custCreated = 0;
  let custUpdated = 0;
  const custSkipped: string[] = [];

  for (const r of custRows) {
    const customerNo = cell(r[1]);
    const name = cell(r[2]);
    if (!name) continue;

    const nameKey = normalizeName(name);
    const city = cell(r[3]);
    const fields = {
      name,
      nameKey,
      // No English name in the register, and every picker falls back to `name`.
      nameAr: name,
      customerNo,
      cityId: cityIdByName.get(city) ?? null,
      salesRepNo: cell(r[4]),
      salesRepName: cell(r[5]),
      accountOpenedAt: excelDate(r[6]),
      idNumber: cell(r[7]),
      isActive: true,
    };

    /**
     * Matched on the customer NUMBER first — it is the register's own
     * identity and survives a renamed shop — and only then on the name, which
     * is what an earlier manual entry would have been keyed by.
     */
    const found = (await LabCustomer.findOne(
      customerNo ? { $or: [{ customerNo }, { nameKey }] } : { nameKey }
    ).lean()) as { _id: mongoose.Types.ObjectId } | null;

    if (found) {
      custUpdated++;
      if (!DRY) await LabCustomer.updateOne({ _id: found._id }, { $set: fields });
      continue;
    }
    custCreated++;
    if (DRY) continue;
    try {
      await LabCustomer.create(fields);
    } catch (err) {
      // A unique index refused it: report the row rather than losing it in a
      // stack trace halfway through 351 writes.
      custSkipped.push(`${customerNo} ${name} — ${(err as Error).message.slice(0, 90)}`);
      custCreated--;
    }
  }
  console.log(`Customers: ${custCreated} created, ${custUpdated} updated, ${custSkipped.length} refused`);
  custSkipped.forEach((s) => console.log(`   ⚠️  ${s}`));

  // ── Products ────────────────────────────────────────────────────────────
  const prodRows = rowsOf(SHEET_PRODUCTS).slice(1).filter((r) => cell(r[1]) || cell(r[2]));
  const bases = new Map<string, number>();
  const unclassified: string[] = [];

  for (const r of prodRows) {
    const raw = baseName(r[2]);
    const base = SPELLING_FIXES[raw] ?? raw;
    if (!base) continue;
    bases.set(base, (bases.get(base) ?? 0) + 1);
  }

  const typeOf = (base: string): string | null =>
    TYPE_BY_PREFIX.find(([prefix]) => base.startsWith(prefix))?.[1] ?? null;

  for (const base of bases.keys()) if (!typeOf(base)) unclassified.push(base);
  console.log(`\nProducts: ${prodRows.length} rows collapse to ${bases.size} names`);
  if (unclassified.length) {
    console.log(`   ⚠️  ${unclassified.length} name(s) matched no product type and were skipped:`);
    unclassified.forEach((u) => console.log(`       ${u}`));
  }

  // Every type the register needs must already exist (migrate:product-catalog).
  const typeIdByName = new Map<string, mongoose.Types.ObjectId>();
  for (const [, typeName] of TYPE_BY_PREFIX) {
    if (typeIdByName.has(typeName)) continue;
    const t = (await LabProduct.findOne({ name: typeName, parentId: null }).lean()) as
      { _id: mongoose.Types.ObjectId } | null;
    if (!t) throw new Error(`Product type "${typeName}" is missing — run npm run migrate:product-catalog first`);
    typeIdByName.set(typeName, t._id);
  }

  // Rename the grades that have a counterpart, so their history stays attached.
  let renamed = 0;
  for (const [oldName, newName] of Object.entries(RENAME)) {
    const g = (await LabProduct.findOne({ name: oldName }).lean()) as { _id: mongoose.Types.ObjectId } | null;
    if (!g) continue;
    renamed++;
    if (!DRY) await LabProduct.updateOne({ _id: g._id }, { $set: { name: newName, nameAr: newName } });
  }
  console.log(`   renamed ${renamed} existing grade(s) onto register names (orders, samples and thresholds follow the _id)`);

  let archived = 0;
  for (const oldName of ARCHIVE) {
    const g = (await LabProduct.findOne({ name: oldName, isActive: true }).lean()) as
      { _id: mongoose.Types.ObjectId } | null;
    if (!g) continue;
    archived++;
    if (!DRY) await LabProduct.updateOne({ _id: g._id }, { $set: { isActive: false } });
  }
  console.log(`   archived ${archived} grade(s) with no counterpart in the register (${ARCHIVE.join(", ")})`);

  let prodCreated = 0;
  let prodKept = 0;
  for (const base of [...bases.keys()].sort()) {
    const typeName = typeOf(base);
    if (!typeName) continue;
    const parentId = typeIdByName.get(typeName)!;

    const existing = (await LabProduct.findOne({ name: base }).lean()) as
      { _id: mongoose.Types.ObjectId } | null;
    if (existing) {
      prodKept++;
      // Re-home and reactivate: a rename above may have landed it, and a grade
      // must sit under the right type to inherit the right lab rule.
      if (!DRY) await LabProduct.updateOne({ _id: existing._id }, { $set: { parentId, isActive: true, nameAr: base } });
      continue;
    }
    prodCreated++;
    if (DRY) continue;
    const parent = (await LabProduct.findById(parentId).select("orderRequiresLabTest").lean()) as
      { orderRequiresLabTest?: boolean } | null;
    await LabProduct.create({
      name: base,
      nameAr: base,
      parentId,
      // Inherited from the type, never guessed — the same rule the API enforces.
      orderRequiresLabTest: parent?.orderRequiresLabTest !== false,
      isActive: true,
    });
  }
  console.log(`   ${prodCreated} grade(s) created, ${prodKept} already present and re-homed`);

  if (DRY) {
    /**
     * A dry run cannot show the effect of writes it did not make: the six
     * renames above did not happen, so those six grades are still counted as
     * "to create" rather than "already present". The real run shows 21 and 6.
     */
    console.log("\nDry run — nothing was written.");
    console.log("   (the renames did not happen, so the create/keep split above is not the real one)");
  } else {
    console.log("\nDone.");
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
