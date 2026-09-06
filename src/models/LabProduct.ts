import mongoose, { Schema, Document } from "mongoose";

/** A flour grade/product the lab tests samples against (e.g. WFP, Super, Bab2…). */
export interface ILabProductDoc extends Document {
  name: string;
  nameAr?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabProductSchema = new Schema<ILabProductDoc>(
  {
    name:     { type: String, required: true, unique: true },
    nameAr:   { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.LabProduct ||
  mongoose.model<ILabProductDoc>("LabProduct", LabProductSchema);
