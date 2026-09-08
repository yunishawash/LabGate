import mongoose, { Schema } from "mongoose";

/**
 * A monotonic counter, one document per sequence (e.g. `order-2026`).
 *
 * `findOneAndUpdate({_id}, {$inc: {seq: 1}})` is atomic on a single document,
 * so this never collides and never needs a retry — unlike read-the-max-then-
 * insert, which is what the CMMS does and which measurably fails under load:
 * 20 simultaneous creates lost 4 to duplicate-key errors even with 10 retries,
 * because every retry re-reads the same maximum and races again.
 *
 * The trade is that a failed insert AFTER a successful increment leaves a gap
 * in the numbering. That is the right trade: a gap is a cosmetic oddity, a
 * refused order is a person standing at a desk unable to work.
 */
// Not `extends Document`: this model keys on a STRING _id ("order-2026"), and
// Document's generic defaults its _id to ObjectId.
export interface ICounterDoc {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounterDoc>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter =
  mongoose.models.Counter || mongoose.model<ICounterDoc>("Counter", CounterSchema);

export default Counter;

/** Next value in `name`'s sequence. Atomic; creates the counter on first use. */
export async function nextSequence(name: string): Promise<number> {
  const doc = (await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean()) as { seq: number };
  return doc.seq;
}
