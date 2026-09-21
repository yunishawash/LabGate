/**
 * Adds N Pending orders whose `currentStageEnteredAt` is already past the
 * "stuck" threshold (`LATE_HOURS`/`STUCK_HOURS`, currently 48h) — quick data
 * for exercising the dashboard's "Overdue orders" widget and its pagination
 * without waiting days for real orders to age.
 *
 * Uses the real `createSalesOrder()` helper (not a raw insert like
 * `seed-demo-orders.ts`) so every order is a fully valid, freshly-numbered
 * document at stage 2 (waiting on the Sales Manager) — only its
 * `currentStageEnteredAt` is backdated afterwards, by a direct update, since
 * Mongoose always stamps that field at creation.
 *
 *   npx tsx src/scripts/seed-stuck-orders.ts            # 50 orders
 *   npx tsx src/scripts/seed-stuck-orders.ts --count=20  # a different amount
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import { createSalesOrder } from "../lib/salesOrder";
import SalesOrder from "../models/SalesOrder";
import LabCustomer from "../models/LabCustomer";
import LabProduct from "../models/LabProduct";
import User from "../models/User";
import { BAG_WEIGHTS } from "../types";

const countArg = process.argv.find((a) => a.startsWith("--count="));
const COUNT = countArg ? Number(countArg.split("=")[1]) : 50;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  await connectDB();

  const [customers, products, coordinator] = await Promise.all([
    LabCustomer.find({ isActive: true }).select("_id name nameAr").lean(),
    LabProduct.find({ isActive: true }).select("_id name nameAr").lean(),
    User.findOne({ role: "sales_coordinator", isActive: true }).select("_id name").lean(),
  ]);

  if (!customers.length || !products.length || !coordinator) {
    console.error("Need at least one active customer, one active product, and a sales_coordinator user (run `npm run seed` / `npm run seed:customers` / `npm run seed:lab` first).");
    process.exit(1);
  }

  const actor = { _id: coordinator._id as mongoose.Types.ObjectId, name: (coordinator as { name: string }).name };
  const now = Date.now();

  console.log(`Creating ${COUNT} stuck orders…`);
  const ids: mongoose.Types.ObjectId[] = [];

  for (let i = 0; i < COUNT; i++) {
    const customer = pick(customers) as { _id: mongoose.Types.ObjectId };
    const lineCount = 1 + Math.floor(Math.random() * 2);
    const lines = Array.from({ length: lineCount }, () => {
      const bagWeightKg = pick(BAG_WEIGHTS as unknown as number[]);
      const bagCount = 5 + Math.floor(Math.random() * 40);
      const product = pick(products) as { _id: mongoose.Types.ObjectId; name?: string; nameAr?: string };
      return {
        productId: product._id,
        product: product.name || "",
        productAr: product.nameAr || "",
        bagWeightKg,
        bagCount,
        lineWeightKg: bagWeightKg * bagCount,
        note: "",
      };
    });
    const totalBags = lines.reduce((n, l) => n + l.bagCount, 0);
    const totalWeightKg = lines.reduce((n, l) => n + l.lineWeightKg, 0);

    const order = await createSalesOrder(
      {
        customerId: customer._id,
        customer: "", customerAr: "",
        orderDate: new Date(now - (3 + Math.random() * 20) * 86_400_000),
        deliveryDate: null,
        notes: "",
        lines, totalBags, totalWeightKg,
      },
      actor
    );

    // Backdate PAST the stuck threshold. createSalesOrder always sets this to
    // "now" — a direct update is the only way to make it old, same reasoning
    // `seed-demo-orders.ts` documents for `createdAt`.
    const staleBy = (2 + Math.random() * 12) * 86_400_000; // 2–14 days overdue
    await SalesOrder.updateOne(
      { _id: order._id },
      { $set: { currentStageEnteredAt: new Date(now - staleBy) } }
    );
    ids.push(order._id as mongoose.Types.ObjectId);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${COUNT}…`);
  }

  console.log(`\nDone — ${ids.length} stuck orders created.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
