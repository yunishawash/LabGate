/**
 * Proves the order-number allocator is race-safe: 20 orders created at once
 * must yield 20 distinct, gapless numbers. `countDocuments() + 1` fails this.
 *   npm run check:concurrency
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { createSalesOrder } from "../lib/salesOrder";
import SalesOrder from "../models/SalesOrder";
import LabCustomer from "../models/LabCustomer";
import LabProduct from "../models/LabProduct";
import User from "../models/User";

const N = 20;

async function main() {
  await connectDB();

  const [customer, product, user] = await Promise.all([
    LabCustomer.findOne({ isActive: true }).lean() as Promise<{ _id: mongoose.Types.ObjectId; name: string } | null>,
    LabProduct.findOne({ isActive: true }).lean() as Promise<{ _id: mongoose.Types.ObjectId; name: string } | null>,
    User.findOne({ role: "sales_coordinator" }).lean() as Promise<{ _id: mongoose.Types.ObjectId; name: string } | null>,
  ]);
  if (!customer || !product || !user) {
    throw new Error("seed first: npm run seed && npm run seed:lab, and add one customer");
  }

  const before = await SalesOrder.countDocuments();

  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      createSalesOrder(
        {
          customerId: customer._id,
          customer: customer.name,
          orderDate: new Date(),
          lines: [{
            productId: product._id, product: product.name,
            bagWeightKg: 50, bagCount: 100, lineWeightKg: 5000,
          }],
          totalBags: 100,
          totalWeightKg: 5000,
        },
        { _id: user._id, name: user.name }
      )
    )
  );

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  const created = await SalesOrder.find({}).sort({ orderNumber: 1 }).select("orderNumber").lean() as { orderNumber: string }[];
  const numbers = created.map((o) => o.orderNumber);
  const unique = new Set(numbers);

  console.log(`created            ${ok}/${N}${failed.length ? `  (${failed.length} failed)` : ""}`);
  console.log(`orders in db       ${before} -> ${created.length}`);
  console.log(`distinct numbers   ${unique.size} of ${numbers.length}`);
  console.log(`first / last       ${numbers[0]} … ${numbers[numbers.length - 1]}`);

  const seqs = numbers.map((n) => parseInt(n.slice(-6), 10)).sort((a, b) => a - b);
  const gaps = seqs.filter((v, i) => i > 0 && v !== seqs[i - 1] + 1);

  const pass = unique.size === numbers.length && ok === N && gaps.length === 0;
  console.log(`gaps in sequence   ${gaps.length}`);
  console.log(`\n${pass ? "PASS — every number unique and gapless" : "FAIL"}`);

  for (const f of failed.slice(0, 3)) console.error("  ", (f as PromiseRejectedResult).reason?.message);

  await mongoose.disconnect();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
