/**
 * The plant's customer list, transcribed from the client's handwritten sheet.
 *
 * ONLY the eight names that were legible with confidence are here. Eleven more
 * were best-effort readings of difficult handwriting and are listed in SPEC §17
 * as awaiting confirmation — a misspelled customer name propagates into every
 * order, every QC sample and every printed report, so guessing is worse than
 * waiting.
 *
 * Idempotent: upserts on the normalized name key.
 *   npm run seed:customers
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { normalizeName } from "../lib/apiHelpers";
import LabCustomer from "../models/LabCustomer";

const CONFIRMED: { name: string; nameAr: string }[] = [
  { name: "Khader Salem & Sons",  nameAr: "خضر سالم وأولاده" },
  { name: "Khader Ashour",        nameAr: "خضر عاشور" },
  { name: "Beit Sira Bakery",     nameAr: "مخبز بيت سيرا" },
  { name: "Abu Shusha Bakery",    nameAr: "مخبز أبو شوشة" },
  { name: "Al Baraka Bakery",     nameAr: "مخبز البركة" },
  { name: "Al Balad Bakery",      nameAr: "مخبز البلد" },
  { name: "Palestine Poultry Co.", nameAr: "شركة دواجن فلسطين" },
  { name: "Khawaja Co.",          nameAr: "شركة خواجا" },
];

async function main() {
  await connectDB();

  for (const c of CONFIRMED) {
    const nameKey = normalizeName(c.name);
    const res = await LabCustomer.updateOne(
      { nameKey },
      {
        $set: { name: c.name, nameAr: c.nameAr, isActive: true },
        $setOnInsert: { nameKey, code: "", phone: "", contactName: "", address: "", notes: "" },
      },
      { upsert: true }
    );
    console.log(`  ${res.upsertedCount ? "created" : "updated"}  ${c.nameAr.padEnd(22)} ${c.name}`);
  }

  const total = await LabCustomer.countDocuments({ isActive: true });
  console.log(`\n${CONFIRMED.length} confirmed names seeded · ${total} active customers in total.`);
  console.log("11 further names from the sheet are still unconfirmed — see SPEC §17.");

  await mongoose.disconnect();
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
