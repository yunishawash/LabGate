/**
 * Backfill `nameKey` on existing customers and drop any duplicates that got in
 * before the partial unique index existed. Idempotent.
 *   npm run migrate:customer-namekey
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { normalizeName } from "../lib/apiHelpers";

async function main() {
  await connectDB();
  const col = mongoose.connection.collection("labcustomers");

  const all = await col.find({}).toArray();
  const seen = new Map<string, unknown>();
  let filled = 0, archived = 0;

  for (const c of all) {
    const key = normalizeName(String(c.name ?? ""));
    if (c.isActive !== false && seen.has(key)) {
      // A pre-existing near-duplicate. Archive rather than delete: it may be
      // referenced by samples, and the merge tool can repoint those properly.
      await col.updateOne({ _id: c._id }, { $set: { isActive: false, nameKey: key } });
      console.log(`  archived duplicate: "${c.name}"`);
      archived++;
      continue;
    }
    if (c.isActive !== false) seen.set(key, c._id);
    if (c.nameKey !== key) {
      await col.updateOne({ _id: c._id }, { $set: { nameKey: key } });
      filled++;
    }
  }

  await mongoose.connection.syncIndexes();
  console.log(`\nnameKey filled on ${filled}, duplicates archived: ${archived}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
