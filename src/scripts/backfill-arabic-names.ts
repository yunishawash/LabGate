/**
 * Fills `customerAr` / `lines[].productAr` on orders written before the order
 * carried Arabic names of its own.
 *
 * Denormalized fields are frozen copies on purpose — nothing re-reads
 * LabCustomer per row — so adding one to the schema does not populate history.
 * Idempotent: re-running only touches documents still missing a value.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import SalesOrder from "../models/SalesOrder";
import LabCustomer from "../models/LabCustomer";
import LabProduct from "../models/LabProduct";

async function main() {
  await connectDB();

  const customers = new Map<string, string>();
  for (const c of await LabCustomer.find().select("nameAr").lean()) {
    customers.set(String((c as { _id: unknown })._id), (c as { nameAr?: string }).nameAr || "");
  }
  const products = new Map<string, string>();
  for (const p of await LabProduct.find().select("nameAr").lean()) {
    products.set(String((p as { _id: unknown })._id), (p as { nameAr?: string }).nameAr || "");
  }

  const orders = await SalesOrder.find().select("customerId customerAr lines").lean();
  let touched = 0;

  for (const o of orders) {
    const doc = o as unknown as {
      _id: unknown; customerId: unknown; customerAr?: string;
      lines: { productId: unknown; productAr?: string }[];
    };
    const set: Record<string, string> = {};

    if (!doc.customerAr) {
      const ar = customers.get(String(doc.customerId));
      if (ar) set.customerAr = ar;
    }
    doc.lines?.forEach((l, i) => {
      if (l.productAr) return;
      const ar = products.get(String(l.productId));
      if (ar) set[`lines.${i}.productAr`] = ar;
    });

    if (Object.keys(set).length) {
      await SalesOrder.updateOne({ _id: doc._id }, { $set: set });
      touched++;
    }
  }

  console.log(`orders scanned: ${orders.length} · updated: ${touched}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
