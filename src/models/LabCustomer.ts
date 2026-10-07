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
  /**
   * The commercial register's own number for this account ("C0000032").
   *
   * Distinct from `code`, which was a free field nobody filled: this one comes
   * from the office's own ledger, is unique there, and is how staff refer to a
   * customer on the phone. Unique among ACTIVE rows but optional, so a customer
   * created in the app before the office issues a number is still valid.
   */
  customerNo?: string;
  /** Which city this customer is in — a row in `City`, never a typed string,
   *  because the reason it is recorded is to group reports by it. */
  cityId?: mongoose.Types.ObjectId | null;
  /** The sales rep's own number ("SM001"), beside the name below. The register
   *  maps one number to exactly one name, verified across all 351 rows. */
  salesRepNo?: string;
  /** When the account was opened in the office's ledger. */
  accountOpenedAt?: Date | null;
  /** National ID / registration number. Present on about a quarter of the
   *  register, so never assume it is there. */
  idNumber?: string;
  phone?: string;
  contactName?: string;
  /** The sales rep (المندوب) who handles this customer — printed on every
   *  order for them. Snapshotted onto each order at creation, like the address. */
  salesRepName?: string;
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
    customerNo:  { type: String, default: "", trim: true },
    cityId:      { type: Schema.Types.ObjectId, ref: "City", default: null },
    salesRepNo:  { type: String, default: "", trim: true },
    accountOpenedAt: { type: Date, default: null },
    idNumber:    { type: String, default: "", trim: true },
    phone:       { type: String, default: "" },
    contactName: { type: String, default: "" },
    salesRepName: { type: String, default: "", trim: true },
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
// `$gt: ""` excludes the empty default, so any number of customers may have no
// number while the ones that do are still forced unique.
LabCustomerSchema.index(
  { customerNo: 1 },
  { unique: true, partialFilterExpression: { isActive: true, customerNo: { $gt: "" } } }
);
// "every customer in this city" — the query the whole City collection exists for.
LabCustomerSchema.index({ cityId: 1, name: 1 });

export default mongoose.models.LabCustomer ||
  mongoose.model<ILabCustomerDoc>("LabCustomer", LabCustomerSchema);
