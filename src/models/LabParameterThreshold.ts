import mongoose, { Schema, Document } from "mongoose";

/**
 * A per-product override of a LabParameter's default limit — e.g. Ash% has a
 * different acceptable range for every flour grade, and Moisture% has no
 * defined limit at all for product "Bab 1" (operator "none" overrides the
 * parameter's normal operator for that one product).
 *
 * If no row exists for a given (parameterId, productId) pair, the
 * parameter's defaultMin/defaultMax/operator apply — see
 * src/lib/labThreshold.ts::resolveThreshold().
 */
export interface ILabParameterThresholdDoc extends Document {
  parameterId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  min: number | null;
  max: number | null;
  /** Recommended value for this product — see LabParameter.defaultTarget. */
  target: number | null;
  operator?: "n_m_t" | "n_l_t" | "range" | "none" | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabParameterThresholdSchema = new Schema<ILabParameterThresholdDoc>(
  {
    parameterId: { type: Schema.Types.ObjectId, ref: "LabParameter", required: true },
    productId:   { type: Schema.Types.ObjectId, ref: "LabProduct", required: true },
    min:         { type: Number, default: null },
    max:         { type: Number, default: null },
    target:      { type: Number, default: null },
    operator:    { type: String, enum: ["n_m_t", "n_l_t", "range", "none", null], default: null },
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

LabParameterThresholdSchema.index({ parameterId: 1, productId: 1 }, { unique: true });

export default mongoose.models.LabParameterThreshold ||
  mongoose.model<ILabParameterThresholdDoc>("LabParameterThreshold", LabParameterThresholdSchema);
