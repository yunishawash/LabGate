import mongoose, { Schema, Document } from "mongoose";

/**
 * A product the mill sells and the lab tests samples against.
 *
 * ── Two levels, one collection ──────────────────────────────────────────────
 *
 * The catalogue is a shallow tree, because the plant's own vocabulary has two
 * words in it: **نوع المنتج** (a product type) and **صنف** (a grade of it).
 *
 *     طحين   (type, parentId: null)
 *       ├── WFP, 302, 305, Bab2, Sanabel, Bab 1, Fakher, Super   (grades)
 *     نخالة  (type, parentId: null, no grades)
 *     جيرم   · سميد · قمح                                        (likewise)
 *
 * `parentId === null` means a TYPE; anything else is a grade of that type.
 *
 * It is one collection rather than two because نخالة is *both*: it is a
 * product type AND the thing that actually goes on an order line. Splitting
 * types and grades into separate collections would force a fake grade called
 * "نخالة" underneath a type called "نخالة" just to give the order line
 * something to point at — and it would turn one foreign key into two
 * everywhere an order line, a lab sample and a threshold refer to a product.
 *
 * ── What is orderable is a LEAF ─────────────────────────────────────────────
 *
 * A product with no active children. طحين is not orderable (you order Super,
 * not "flour"); نخالة is, because nothing sits under it. The same rule governs
 * what the lab can test and hold a spec sheet for. Adding a grade under نخالة
 * later would make نخالة itself stop being offered, and already-raised orders
 * would keep their denormalized `product`/`productAr` text — correct either
 * way.
 */
export interface ILabProductDoc extends Document {
  name: string;
  nameAr?: string;
  /**
   * The product TYPE this grade belongs to, or `null` when this row IS a type.
   * One level only: a grade may not have grades of its own, which the routes
   * enforce by refusing a parent that itself has a parent.
   */
  parentId: mongoose.Types.ObjectId | null;
  /**
   * Does a SALES ORDER carrying this product have to pass through stage 6
   * (lab results) before it can be signed off and weighed?
   *
   * ⚠️ This is NOT "can the lab test this product". The lab tests wheat
   * routinely as incoming-grain QC, and a wheat sample is created through the
   * ordinary lab screens like any other — but a wheat *order* carries no lab
   * gate, because the release test belongs to flour alone. The two questions
   * are genuinely separate, which is why this field names the order chain in
   * its own name rather than saying "requiresLabTest" and leaving the reader
   * to guess which of the two it meant.
   *
   * Defaults to TRUE so a product added without thinking about it inherits
   * the stricter path: an order that waits for a test it did not need is a
   * visible delay, where one that skips a test it did need is a shipped
   * defect.
   *
   * ⚠️ The decision belongs to the TYPE — "flour is tested, bran is not" is a
   * statement about flour, not about Super in particular. Grades carry a
   * denormalized copy that the type's own update cascades into, so the one
   * query `buildOrderLines` makes per line answers the question outright
   * instead of climbing the tree. Only a type's copy is editable; a grade's
   * is written for it.
   */
  orderRequiresLabTest: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabProductSchema = new Schema<ILabProductDoc>(
  {
    name:     { type: String, required: true, unique: true },
    nameAr:   { type: String, default: "" },
    parentId: { type: Schema.Types.ObjectId, ref: "LabProduct", default: null },
    orderRequiresLabTest: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// "Which grades belong to this type" is asked on every load of the order
// dialog, the sample form and the specs screen.
LabProductSchema.index({ parentId: 1, name: 1 });

export default mongoose.models.LabProduct ||
  mongoose.model<ILabProductDoc>("LabProduct", LabProductSchema);
