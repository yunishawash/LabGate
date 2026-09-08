import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * A named stand-in: the primary hands one stage's role to a specific person for
 * a specific period. The client's "من يكلفه مدير المبيعات مكانه" and the lab's
 * "أيّهما مفوّض".
 *
 * Distinct from a DEPUTY, which is written into the stage table and opens only
 * while the primary is away. A delegation is deliberate and works either way.
 *
 * Creating, editing or revoking one moves signing authority, so every change is
 * audited exactly like an approval.
 */
export interface IDelegationDoc extends Document {
  role: string;
  fromUserId: Types.ObjectId | null;
  toUserId: Types.ObjectId;
  toUserName: string;
  from: Date;
  to: Date;
  reason: string;
  createdById: Types.ObjectId;
  createdByName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DelegationSchema = new Schema<IDelegationDoc>(
  {
    role: { type: String, required: true },
    // Null when an admin issues the delegation rather than the primary.
    fromUserId:  { type: Schema.Types.ObjectId, ref: "User", default: null },
    toUserId:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    toUserName:  { type: String, default: "" },
    from:        { type: Date, required: true },
    // Required on purpose: a delegation with no expiry is a permanent transfer
    // of authority by accident.
    to:          { type: Date, required: true },
    reason:      { type: String, default: "" },
    createdById:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, default: "" },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

// "What is this person allowed to act as right now" — the hot path.
DelegationSchema.index({ toUserId: 1, isActive: 1, from: 1, to: 1 });
// "Is this role already delegated" — the overlap check.
DelegationSchema.index({ role: 1, isActive: 1 });

export default mongoose.models.Delegation ||
  mongoose.model<IDelegationDoc>("Delegation", DelegationSchema);
