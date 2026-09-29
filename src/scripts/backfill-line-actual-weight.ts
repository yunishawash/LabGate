/**
 * Fills `lines[0].actualWeightKg` on single-line Posted orders written before
 * weighing was recorded per line — back when only the order-level
 * `actualNetWeightKg` existed.
 *
 * Safe ONLY for single-line orders: with exactly one line, the order-level
 * total unambiguously IS that line's own reading, not a guess. A multi-line
 * order's total can't be un-mixed back into its lines — those are left alone.
 * Idempotent: re-running only touches lines still missing a value.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import SalesOrder from "../models/SalesOrder";

async function main() {
  await connectDB();

  const orders = await SalesOrder.find({ status: "Posted", actualNetWeightKg: { $ne: null } })
    .select("orderNumber actualNetWeightKg lines")
    .lean();

  let touched = 0, skippedMultiLine = 0;

  for (const raw of orders) {
    const o = raw as unknown as {
      _id: unknown; orderNumber: string; actualNetWeightKg: number;
      lines: { actualWeightKg?: number | null }[];
    };
    if (o.lines.length !== 1) {
      if (o.lines.every((l) => l.actualWeightKg == null)) skippedMultiLine++;
      continue;
    }
    if (o.lines[0].actualWeightKg != null) continue; // already filled

    await SalesOrder.updateOne(
      { _id: o._id },
      { $set: { "lines.0.actualWeightKg": o.actualNetWeightKg } }
    );
    touched++;
  }

  console.log(`orders scanned: ${orders.length} · single-line backfilled: ${touched} · multi-line left as-is: ${skippedMultiLine}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
