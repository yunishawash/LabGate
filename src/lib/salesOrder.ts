import mongoose from "mongoose";
import SalesOrder, { buildInitialSteps } from "@/models/SalesOrder";
import { nextSequence } from "@/models/Counter";

/**
 * Create an order with a unique `orderNumber` — ORD-<year>-<6 digits>, the
 * sequence restarting each calendar year.
 *
 * The number comes from an atomic counter (see `models/Counter.ts`), not from
 * reading the current maximum. The read-then-retry approach the CMMS uses looks
 * safe and measurably is not: `npm run check:concurrency` lost 4 of 20
 * simultaneous creates to duplicate-key errors with it, because each retry
 * re-reads the same maximum and races again. A single `$inc` cannot collide.
 *
 * It also BUILDS THE STEPS ARRAY itself, so no caller can construct a
 * malformed chain.
 */
export async function createSalesOrder(
  data: Record<string, unknown>,
  actor: { _id: mongoose.Types.ObjectId; name: string }
) {
  const year = new Date().getFullYear();
  const now = new Date();

  const seq = await nextSequence(`order-${year}`);
  const orderNumber = `ORD-${year}-${String(seq).padStart(6, "0")}`;

  return SalesOrder.create({
    ...data,
    orderNumber,
    steps: buildInitialSteps(actor, now),
    // Stage 1 is complete at creation, so a new order is already waiting on the
    // sales manager.
    currentStageIndex: 2,
    currentStageEnteredAt: now,
    createdById: actor._id,
    createdByName: actor.name,
    status: "Pending",
    isActive: true,
  });
}
