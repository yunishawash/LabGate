import mongoose, { Schema, Document, Types } from "mongoose";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { BAG_WEIGHTS, LINE_PACKAGING, type LinePackaging } from "@/types";

/**
 * One product line — bagged, or loaded loose.
 *
 * `packaging` decides which of the two shapes the line is in, and it is the
 * field every reader must branch on BEFORE touching `bagWeightKg` or
 * `bagCount`:
 *
 *   bagged — the mill fills sacks. `bagWeightKg` × `bagCount` IS the weight.
 *   bulk   — the customer's truck parks under the spout and the product is
 *            poured straight in (صبّ). There are no sacks to count, so both
 *            bag fields are `null` and `lineWeightKg` is the ordered weight
 *            itself. Any product can be sold either way — bran and wheat
 *            usually are, but a flour line can be too.
 *
 * `null` rather than `0` for the bag fields on a bulk line, deliberately: a
 * zero bag count reads as "bagged, none ordered", which is a different and
 * false statement, and it would quietly pass every `?? 0` in the reports.
 */
export interface ISalesOrderLine {
  productId: Types.ObjectId;
  product: string;
  productAr: string;              // denormalized, frozen at write time
  packaging: LinePackaging;
  bagWeightKg: number | null;   // one of BAG_WEIGHTS · null when bulk
  bagCount: number | null;      // null when bulk
  /** Bagged: = bagWeightKg × bagCount. Bulk: the ordered weight as entered.
   *  Computed SERVER-SIDE only in both cases, never trusted from the client —
   *  the same rule the lab applies to a scored result. */
  lineWeightKg: number;
  note?: string;
  /** A sales concession known at order-creation time — NOT the packed-bags
   *  fact, which belongs to the weighbridge at stage 8. Kept out of
   *  `bagCount`/`lineWeightKg` so it never silently inflates the numbers the
   *  variance/report/export math already depends on.
   *
   *  Always 0 on a bulk line: a bonus is counted in sacks, and a poured load
   *  has none. A concession on a bulk line is expressed by ordering more. */
  bonusBags?: number;
  /** The weighbridge fact this comment used to only promise: this product's
   *  own scale reading, entered separately from every other line on the same
   *  order. `null` until stage 8 resolves it. */
  actualWeightKg: number | null;
}

/**
 * One actionable slot in the chain. There is exactly one step per stage key;
 * an index CAN be held by more than one step sharing that `stageIndex` (a
 * dual sign-off) — none currently is. `stageComplete` asks "is every LIVE
 * step at this index done", so a joint gate needs no special case anywhere,
 * and a stage reduced from two signatures to one leaves no orphaned step
 * blocking an order that was already in flight.
 */
export interface ISalesOrderStep {
  stageKey: string;
  stageIndex: number;
  role: string;
  kind: string;
  status: string;
  /** When this step became actionable. Without it there is no cycle-time
   *  report — you can tell when someone signed, but not how long they sat on it. */
  enteredAt: Date | null;
  actedById: Types.ObjectId | null;
  actedByName: string;
  actedAt: Date | null;
  /** The capacity the signature was made in. A deputy's signature that looked
   *  identical to the owner's would hollow out the whole chain. */
  actedAs: string;
  actedForRole: string;
  /** The real name of whoever holds `actedForRole`, snapshotted at signing
   *  time — "بالإنابة عن أحمد محمد", not just "بالإنابة عن المدير المالي".
   *  Empty when `actedAs` is "primary" (nobody was stood in for). */
  actedForName: string;
  note: string;
}

export interface ISalesOrderDoc extends Document {
  orderNumber: string;
  referenceNo: string;
  customerId: Types.ObjectId;
  customer: string;
  customerAr: string;
  orderDate: Date;
  deliveryDate?: Date | null;
  notes: string;
  /** Printed on the MS-SC/F7 form. Frozen at creation like `customer`/
   *  `customerAr` — a later edit to the LabCustomer record must not rewrite an
   *  already-approved paper trail. */
  customerAddress: string;
  salesRepName: string;
  agentName: string;
  paymentMethod: "cash" | "deferred" | "";
  lines: ISalesOrderLine[];
  /**
   * Does THIS order have to pass stage 6 (lab results)?
   *
   * Decided once, at creation, from the products on the lines, and frozen —
   * never re-derived on read. Two reasons it has to be stored rather than
   * computed:
   *
   *   1. An order's path through the chain must not change because somebody
   *      flipped `orderRequiresLabTest` on a product months later. An order
   *      already sitting at stage 7 cannot be sent back to 6, and
   *      `currentStageIndex` is monotonic by design — so a re-derived value
   *      would produce an order that is simultaneously past the lab gate and
   *      waiting for it.
   *   2. It is what the stage-6 step's `skipped` status is built from, and the
   *      two must agree forever.
   *
   * An order may not mix tested and untested products (the client's rule), so
   * one flag for the whole order is the exact shape of the fact.
   */
  labRequired: boolean;
  totalBags: number;
  totalWeightKg: number;
  totalBonusBags: number;
  totalBonusWeightKg: number;
  status: string;
  currentStageIndex: number;
  currentStageEnteredAt: Date;
  steps: ISalesOrderStep[];
  rejection?: {
    stageIndex: number | null;
    stageKey: string;
    role: string;
    /** The human-readable reason, always populated — the free text as typed,
     *  or the chosen reason's label with any note appended. This is the field
     *  every existing reader (report, export, timeline, notification) already
     *  prints, so it must never be left empty just because a list was used. */
    reason: string;
    /** Set only when the reason came from the managed list. `reasonLabel` is
     *  denormalized alongside it so retiring or rewording a reason row cannot
     *  rewrite why an order was already killed. */
    reasonId: Types.ObjectId | null;
    reasonLabel: string;
    byId: Types.ObjectId | null;
    byName: string;
    at: Date | null;
  };
  labSampleIds: Types.ObjectId[];
  labOverallStatus: string;
  actualNetWeightKg: number | null;
  varianceKg: number | null;
  variancePct: number | null;
  weighNote: string;
  /**
   * Why the scale disagreed with the order — kept apart from `weighNote` on
   * purpose. The note is whatever the operator wants to record about the
   * load; this is the justification for a specific number, demanded only when
   * the gap exceeds `VARIANCE_TOLERANCE_PCT`, and it is what the variance
   * report and the weighbridge certificate print. Folding the two together
   * would mean a report column that is sometimes an explanation and sometimes
   * "truck 4 came late".
   */
  varianceReason: string;
  /**
   * The physical load, as the weighbridge records it.
   *
   * These used to be blank ruled lines on the printed certificate for the
   * operator to fill in by hand, which meant the system held a net weight it
   * could not attribute to a truck: no vehicle, no driver, no carrier, and no
   * gross or tare to show the net was ever derived from a scale at all.
   *
   * `grossWeightKg` and `tareWeightKg` are kilograms like every other stored
   * weight, entered in tonnes (§14.1). Their difference is the load the scale
   * saw; `actualNetWeightKg` is the per-line breakdown the operator typed.
   * The two answer the same question from different directions and are
   * expected to agree — which is exactly why both are kept rather than one
   * derived from the other.
   */
  weighDestination: string;
  weighVehicleNo: string;
  weighCarrier: string;
  weighDriver: string;
  grossWeightKg: number | null;
  tareWeightKg: number | null;
  weighedById: Types.ObjectId | null;
  weighedByName: string;
  postedAt: Date | null;
  createdById: Types.ObjectId;
  createdByName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Plain subdocuments, NOT chain stages — neither gates the order, so adding
   * them here costs zero index/stage-table changes and leaves
   * `currentStageIndex`'s meaning untouched. See SalesOrder annotations route.
   */
  collections: { note: string; byId: Types.ObjectId | null; byName: string; at: Date | null };
  packing: { note: string; byId: Types.ObjectId | null; byName: string; at: Date | null };
}

const SalesOrderLineSchema = new Schema<ISalesOrderLine>(
  {
    productId:    { type: Schema.Types.ObjectId, ref: "LabProduct", required: true },
    product:      { type: String, default: "" },
    productAr:    { type: String, default: "" },
    packaging:    { type: String, enum: [...LINE_PACKAGING], default: "bagged" },

    /**
     * The two bag fields went from `required` to nullable when bulk loading
     * arrived, which would have thrown away the schema's own guarantee that a
     * bagged line carries a real sack size and at least one sack. These
     * validators keep that guarantee and extend it to the other half of the
     * rule — that a bulk line carries NEITHER — so the pairing cannot be
     * broken by a migration, a script or a future route that forgets.
     *
     * `src/lib/salesOrderLines.ts` checks the same rule against the client's
     * input and returns a readable 400 — that is the real guard, and it is
     * also the only one on the edit path, since `findOneAndUpdate` does not
     * run validators. These catch the paths that go through `create()`:
     * a new order, a seed, a migration.
     */
    bagWeightKg: {
      type: Number,
      default: null,
      validate: {
        validator(v: number | null) {
          const { packaging } = this as unknown as ISalesOrderLine;
          return packaging === "bulk"
            ? v == null
            : v != null && (BAG_WEIGHTS as readonly number[]).includes(v);
        },
        message: `bagWeightKg must be one of ${BAG_WEIGHTS.join(", ")} kg on a bagged line, and null on a bulk line`,
      },
    },
    bagCount: {
      type: Number,
      default: null,
      validate: {
        validator(v: number | null) {
          const { packaging } = this as unknown as ISalesOrderLine;
          return packaging === "bulk"
            ? v == null
            : v != null && Number.isInteger(v) && v >= 1;
        },
        message: "bagCount must be a whole number of at least 1 on a bagged line, and null on a bulk line",
      },
    },

    lineWeightKg: { type: Number, required: true },
    note:         { type: String, default: "" },
    bonusBags:    { type: Number, default: 0 },
    actualWeightKg: { type: Number, default: null },
  },
  { _id: false }
);

const SalesOrderStepSchema = new Schema<ISalesOrderStep>(
  {
    stageKey:     { type: String, required: true },
    stageIndex:   { type: Number, required: true },
    role:         { type: String, required: true },
    kind:         { type: String, required: true },
    status:       { type: String, enum: ["pending", "approved", "completed", "rejected", "skipped"], default: "pending" },
    enteredAt:    { type: Date, default: null },
    actedById:    { type: Schema.Types.ObjectId, ref: "User", default: null },
    actedByName:  { type: String, default: "" },
    actedAt:      { type: Date, default: null },
    actedAs:      { type: String, enum: ["primary", "deputy", "delegate", "admin", ""], default: "" },
    actedForRole: { type: String, default: "" },
    actedForName: { type: String, default: "" },
    note:         { type: String, default: "" },
  },
  { _id: false }
);

const SalesOrderSchema = new Schema<ISalesOrderDoc>(
  {
    orderNumber: { type: String, required: true, unique: true },
    /** The department's own number from their own records. Optional and
     *  deliberately NOT unique — it comes from a system this app does not
     *  control, and rejecting a repeat would block a legitimate order. */
    referenceNo: { type: String, default: "", trim: true },

    customerId:   { type: Schema.Types.ObjectId, ref: "LabCustomer", required: true },
    customer:     { type: String, default: "" },
    // Denormalized in BOTH languages: an Arabic screen showing an English
    // customer name is only half-translated, and re-joining LabCustomer on
    // every list row to fix that would defeat the point of denormalizing.
    customerAr:   { type: String, default: "" },
    orderDate:    { type: Date, required: true },
    deliveryDate: { type: Date, default: null },
    notes:        { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    salesRepName:    { type: String, default: "" },
    agentName:       { type: String, default: "" },
    paymentMethod:   { type: String, enum: ["cash", "deferred", ""], default: "" },

    lines:              [SalesOrderLineSchema],
    labRequired:        { type: Boolean, default: true },
    totalBags:          { type: Number, default: 0 },
    totalWeightKg:      { type: Number, default: 0 },
    totalBonusBags:     { type: Number, default: 0 },
    totalBonusWeightKg: { type: Number, default: 0 },

    status: { type: String, enum: ["Pending", "Posted", "Rejected"], default: "Pending", index: true },

    /**
     * ⚠️ MONOTONIC. Nothing may ever decrement this.
     *
     * Because rejection is terminal there is no path backwards, and that single
     * invariant is what turns the visibility rule into one index-backed range
     * query instead of an `$expr` collection scan. Protect it.
     */
    currentStageIndex:     { type: Number, default: 1 },
    currentStageEnteredAt: { type: Date, default: Date.now },
    steps:                 [SalesOrderStepSchema],

    rejection: {
      stageIndex: { type: Number, default: null },
      stageKey:   { type: String, default: "" },
      role:       { type: String, default: "" },
      reason:      { type: String, default: "" },
      reasonId:    { type: Schema.Types.ObjectId, ref: "RejectionReason", default: null },
      reasonLabel: { type: String, default: "" },
      byId:       { type: Schema.Types.ObjectId, ref: "User", default: null },
      byName:     { type: String, default: "" },
      at:         { type: Date, default: null },
    },

    labSampleIds:     [{ type: Schema.Types.ObjectId, ref: "LabSample" }],
    labOverallStatus: { type: String, enum: ["pass", "warning", "fail", ""], default: "" },

    actualNetWeightKg: { type: Number, default: null },
    varianceKg:        { type: Number, default: null },
    variancePct:       { type: Number, default: null },
    weighNote:         { type: String, default: "" },
    varianceReason:    { type: String, default: "" },

    weighDestination:  { type: String, default: "" },
    weighVehicleNo:    { type: String, default: "" },
    weighCarrier:      { type: String, default: "" },
    weighDriver:       { type: String, default: "" },
    // `null`, not 0, on an order weighed before these existed: a zero gross
    // would read as a truck that weighed nothing.
    grossWeightKg:     { type: Number, default: null },
    tareWeightKg:      { type: Number, default: null },

    weighedById:       { type: Schema.Types.ObjectId, ref: "User", default: null },
    weighedByName:     { type: String, default: "" },
    postedAt:          { type: Date, default: null },

    createdById:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, default: "" },
    isActive:      { type: Boolean, default: true },

    collections: {
      note:   { type: String, default: "" },
      byId:   { type: Schema.Types.ObjectId, ref: "User", default: null },
      byName: { type: String, default: "" },
      at:     { type: Date, default: null },
    },
    packing: {
      note:   { type: String, default: "" },
      byId:   { type: Schema.Types.ObjectId, ref: "User", default: null },
      byName: { type: String, default: "" },
      at:     { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Driven by the actual query shapes, not guessed.
SalesOrderSchema.index({ status: 1, currentStageIndex: 1, orderDate: -1 }); // list
SalesOrderSchema.index({ currentStageIndex: 1, currentStageEnteredAt: 1 }); // aging / "waiting on me"
SalesOrderSchema.index({ createdById: 1, createdAt: -1 });                  // creator-sees-own
SalesOrderSchema.index({ "steps.actedById": 1 });                           // past-actor read access
SalesOrderSchema.index({ customerId: 1, orderDate: -1 });                   // per-customer report
SalesOrderSchema.index({ referenceNo: 1 });                                 // searched, not unique
SalesOrderSchema.index({ orderDate: -1 });
SalesOrderSchema.index({ labOverallStatus: 1 });
SalesOrderSchema.index({ "rejection.reasonId": 1 });                        // rejection analysis by reason

/**
 * The chain as stored on a brand-new order: stage 1 done, stage 2 live.
 *
 * When the order carries no lab-tested product, stage 6 is written as
 * `skipped` HERE, at creation, rather than being jumped over at run time.
 * That ordering matters: the step array is the order's own record of its
 * route, so the route has to be decided before anyone acts on it. The
 * alternative — leaving stage 6 pending and teaching the transition code to
 * ignore it — leaves every reader (the ladder, "waiting on me", the aging
 * report, the technician's own queue) believing the lab owes a result it was
 * never going to be asked for.
 *
 * `labRequired: false` only ever skips stage 6. Stage 7 — the General
 * Manager's sign-off — stays live by the client's decision: it is the last
 * human gate before the weighbridge, and it holds whether or not there were
 * results to read.
 */
export function buildInitialSteps(
  actor: { _id: Types.ObjectId; name: string },
  now = new Date(),
  { labRequired = true }: { labRequired?: boolean } = {}
): ISalesOrderStep[] {
  return SALES_STAGES.map((s) => ({
    stageKey: s.key,
    stageIndex: s.index,
    role: s.role,
    kind: s.kind,
    status:
      s.index === 1 ? "completed"
      : !labRequired && s.kind === "data_entry" ? "skipped"
      : "pending",
    enteredAt: s.index <= 2 ? now : null,
    actedById: s.index === 1 ? actor._id : null,
    actedByName: s.index === 1 ? actor.name : "",
    actedAt: s.index === 1 ? now : null,
    actedAs: s.index === 1 ? "primary" : "",
    actedForRole: s.index === 1 ? s.role : "",
    actedForName: "",
    note: "",
  }));
}

export default mongoose.models.SalesOrder ||
  mongoose.model<ISalesOrderDoc>("SalesOrder", SalesOrderSchema);
