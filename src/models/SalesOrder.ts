import mongoose, { Schema, Document, Types } from "mongoose";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { BAG_WEIGHTS } from "@/types";

/** One bagged product line. */
export interface ISalesOrderLine {
  productId: Types.ObjectId;
  product: string;
  productAr: string;              // denormalized, frozen at write time
  bagWeightKg: number;          // one of BAG_WEIGHTS
  bagCount: number;
  /** = bagWeightKg × bagCount. Computed SERVER-SIDE only, never trusted from
   *  the client — the same rule the lab applies to a scored result. */
  lineWeightKg: number;
  note?: string;
}

/**
 * One actionable slot in the chain. There is exactly one step per stage key,
 * and stage 7 is TWO steps sharing `stageIndex: 7` — that is the whole trick
 * behind the dual sign-off. `stageComplete` asks "is every step at this index
 * done", so the joint gate needs no special case anywhere.
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
  lines: ISalesOrderLine[];
  totalBags: number;
  totalWeightKg: number;
  status: string;
  currentStageIndex: number;
  currentStageEnteredAt: Date;
  steps: ISalesOrderStep[];
  rejection?: {
    stageIndex: number | null;
    stageKey: string;
    role: string;
    reason: string;
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
  weighedById: Types.ObjectId | null;
  weighedByName: string;
  postedAt: Date | null;
  createdById: Types.ObjectId;
  createdByName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SalesOrderLineSchema = new Schema<ISalesOrderLine>(
  {
    productId:    { type: Schema.Types.ObjectId, ref: "LabProduct", required: true },
    product:      { type: String, default: "" },
    productAr:    { type: String, default: "" },
    bagWeightKg:  { type: Number, enum: [...BAG_WEIGHTS], required: true },
    bagCount:     { type: Number, required: true, min: 1 },
    lineWeightKg: { type: Number, required: true },
    note:         { type: String, default: "" },
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

    lines:         [SalesOrderLineSchema],
    totalBags:     { type: Number, default: 0 },
    totalWeightKg: { type: Number, default: 0 },

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
      reason:     { type: String, default: "" },
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
    weighedById:       { type: Schema.Types.ObjectId, ref: "User", default: null },
    weighedByName:     { type: String, default: "" },
    postedAt:          { type: Date, default: null },

    createdById:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, default: "" },
    isActive:      { type: Boolean, default: true },
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

/** The chain as stored on a brand-new order: stage 1 done, stage 2 live. */
export function buildInitialSteps(
  actor: { _id: Types.ObjectId; name: string },
  now = new Date()
): ISalesOrderStep[] {
  return SALES_STAGES.map((s) => ({
    stageKey: s.key,
    stageIndex: s.index,
    role: s.role,
    kind: s.kind,
    status: s.index === 1 ? "completed" : "pending",
    enteredAt: s.index <= 2 ? now : null,
    actedById: s.index === 1 ? actor._id : null,
    actedByName: s.index === 1 ? actor.name : "",
    actedAt: s.index === 1 ? now : null,
    actedAs: s.index === 1 ? "primary" : "",
    actedForRole: s.index === 1 ? s.role : "",
    note: "",
  }));
}

export default mongoose.models.SalesOrder ||
  mongoose.model<ISalesOrderDoc>("SalesOrder", SalesOrderSchema);
