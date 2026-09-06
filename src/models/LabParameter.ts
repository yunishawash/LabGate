import mongoose, { Schema, Document } from "mongoose";

/**
 * The lab's quality-parameter catalog (e.g. Moisture, Protein, Wet Gluten, Ash…).
 * Admin/QA-manageable — see the "Parameters & Thresholds" tab on the Lab page —
 * so new tests or limit changes never require a code change.
 *
 * `operator` says how a measured value is judged against its limit(s):
 *   n_m_t  = "not more than"  → pass if value <= max
 *   n_l_t  = "not less than"  → pass if value >= min
 *   range  = pass if min <= value <= max
 *   none   = informational only, always passes (e.g. Color L*)
 *
 * `defaultMin`/`defaultMax`/`defaultTarget` are the plant-wide default
 * limits. A specific product can override any of them via
 * LabParameterThreshold (e.g. Ash% varies per flour grade) — see
 * src/lib/labThreshold.ts for resolution order.
 *
 * `defaultTarget` is the *recommended* value (the workbook's "Target"):
 * not a pass/fail bound, but the ideal the process aims at. It drives the
 * deviation-from-target metric and the chart's target line.
 */
export interface ILabParameterDoc extends Document {
  name: string;
  nameAr?: string;
  unit: string;
  operator: "n_m_t" | "n_l_t" | "range" | "none";
  defaultMin: number | null;
  defaultMax: number | null;
  defaultTarget: number | null;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabParameterSchema = new Schema<ILabParameterDoc>(
  {
    name:       { type: String, required: true, unique: true },
    nameAr:     { type: String, default: "" },
    unit:       { type: String, default: "" },
    operator:   { type: String, enum: ["n_m_t", "n_l_t", "range", "none"], default: "none" },
    defaultMin:    { type: Number, default: null },
    defaultMax:    { type: Number, default: null },
    defaultTarget: { type: Number, default: null },
    order:         { type: Number, default: 0 },
    isActive:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

LabParameterSchema.index({ order: 1 });

export default mongoose.models.LabParameter ||
  mongoose.model<ILabParameterDoc>("LabParameter", LabParameterSchema);
