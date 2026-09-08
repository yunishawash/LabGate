import mongoose, { Schema, Document } from "mongoose";

/**
 * The plant-wide customer table — NOT a lab lookup, despite the name kept from
 * the CMMS for continuity of the collection.
 *
 * An order is placed *by* a customer and a QC sample is judged *for* one, so
 * both halves of the system must key on the same rows: that shared `_id` is the
 * only reason the "tonnage + quality per customer" profile (SPEC §10.1b) can be
 * written at all.
 *
 * ⚠️ Deduplication is the whole game here. In the CMMS the sample dialog's
 * combobox silently created whatever a technician typed — tolerable when a
 * customer was just a label on a test, destructive now that tonnage hangs off
 * the row, because "Al Amal" / "AL AMAL" / "Al-Amal Co." become three customers
 * and split every report three ways. Creation is therefore an explicit,
 * permissioned action and the API rejects case-insensitive duplicates.
 */
export interface ILabCustomerDoc extends Document {
  name: string;
  /** Normalized comparison key (see apiHelpers.normalizeName) — lowercased,
   *  trimmed, internal whitespace collapsed. Uniquely indexed among ACTIVE rows
   *  so the database itself refuses a near-duplicate, rather than relying on a
   *  check two concurrent requests can both pass. */
  nameKey: string;
  nameAr?: string;
  /** The office's own customer code, if they use one. */
  code?: string;
  phone?: string;
  contactName?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabCustomerSchema = new Schema<ILabCustomerDoc>(
  {
    name:        { type: String, required: true, trim: true },
    // No `index: true` here — the real index is the partial unique one below.
    // Declaring both makes Mongoose warn and silently drop the options that
    // matter (unique, partialFilterExpression).
    nameKey:     { type: String, required: true },
    nameAr:      { type: String, default: "" },
    code:        { type: String, default: "", trim: true },
    phone:       { type: String, default: "" },
    contactName: { type: String, default: "" },
    address:     { type: String, default: "" },
    notes:       { type: String, default: "" },
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// `name` itself is not unique — the rule is case- and whitespace-insensitive,
// which is what `nameKey` expresses. Partial, so archiving a customer frees the
// name for reuse.
LabCustomerSchema.index({ name: 1 });
LabCustomerSchema.index(
  { nameKey: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
LabCustomerSchema.index({ code: 1 });

export default mongoose.models.LabCustomer ||
  mongoose.model<ILabCustomerDoc>("LabCustomer", LabCustomerSchema);
