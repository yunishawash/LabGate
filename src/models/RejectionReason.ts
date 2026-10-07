import mongoose, { Schema, Document } from "mongoose";

/**
 * A pickable reason for killing an order — the list the Technical Manager
 * chooses from at stage 5.
 *
 * Rejection has always demanded a written reason, and that free text is what
 * the rejection-analysis report is built from. Free text is the right shape
 * for a finance or GM rejection, which can be about anything; it is the wrong
 * shape for the Technical Manager, whose rejections are a small closed set
 * about the plant's own ability to supply. Twelve spellings of "البضاعة غير
 * متوفرة" are twelve rows in that report and one fact in reality.
 *
 * So the Technical Manager picks from here and may add a note; every other
 * role keeps writing freely. Starts life holding exactly one row — "عدم توفر
 * البضاعة" — and only the system administrator may add to it, which is why
 * this is a collection with an admin screen rather than a constant in a file
 * the client cannot reach.
 */
export interface IRejectionReasonDoc extends Document {
  label: string;
  labelAr: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RejectionReasonSchema = new Schema<IRejectionReasonDoc>(
  {
    // Unique on the English label only: it is the stable key an administrator
    // types once, where the Arabic label is display text that may be reworded.
    label:    { type: String, required: true, unique: true, trim: true },
    labelAr:  { type: String, default: "", trim: true },
    order:    { type: Number, default: 0 },
    /**
     * Retiring a reason is a soft delete, never a hard one. A rejected order
     * keeps a denormalized copy of the label it was rejected under
     * (`rejection.reasonLabel`), so an already-closed order reads correctly
     * either way — but the reason rows are also what the report groups by,
     * and deleting one would silently drop its orders out of the grouping.
     */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RejectionReasonSchema.index({ order: 1, label: 1 });

export default mongoose.models.RejectionReason ||
  mongoose.model<IRejectionReasonDoc>("RejectionReason", RejectionReasonSchema);
