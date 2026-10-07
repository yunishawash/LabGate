import mongoose, { Schema, Document } from "mongoose";

/**
 * A city (مدينة) a customer belongs to.
 *
 * Its own collection rather than a string on the customer, because the point
 * of recording it is to group BY it — tonnage per city, rejections per city —
 * and a free-text field makes "نابلس", "نابلس " and "Nablus" three cities in
 * every report. The customer form picks from this list; nobody types a city.
 *
 * ⚠️ `name` holds the ARABIC name and `nameAr` holds the same string. These
 * places have no English name in the source register, and every picker in the
 * app reads `(lang === "ar" && nameAr) || name` — so writing the Arabic into
 * both makes the list correct in either language with no new display rule. If
 * an English name is ever supplied it replaces `name` alone.
 */
export interface ICityDoc extends Document {
  name: string;
  /** Normalized comparison key — lowercased, trimmed, whitespace collapsed.
   *  Uniquely indexed among ACTIVE rows, the same defence LabCustomer uses. */
  nameKey: string;
  nameAr?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CitySchema = new Schema<ICityDoc>(
  {
    name:     { type: String, required: true, trim: true },
    nameKey:  { type: String, required: true },
    nameAr:   { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CitySchema.index({ name: 1 });
// Partial, so archiving a city frees its name for reuse.
CitySchema.index({ nameKey: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export default mongoose.models.City || mongoose.model<ICityDoc>("City", CitySchema);
