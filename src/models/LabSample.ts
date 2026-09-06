import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * One embedded parameter reading on a LabSample. min/max/operator are
 * resolved (via src/lib/labThreshold.ts::resolveThreshold) and FROZEN at
 * write time — this is the opposite of the app's usual "always override
 * from the live source" convention (e.g. PmTask.pmId is always re-read from
 * Equipment). A QC record must stay historically accurate even if someone
 * edits a threshold later, so the limit actually applied at test time is
 * snapshotted here, not re-derived at read time.
 */
export interface ILabSampleResult {
  parameterId: mongoose.Types.ObjectId;
  parameterName: string;
  unit: string;
  value: number;
  operator: "n_m_t" | "n_l_t" | "range" | "none";
  min: number | null;
  max: number | null;
  /** Recommended value that applied at test time (snapshotted, like min/max). */
  target: number | null;
  /** Signed relative deviation from target, e.g. 0.05 = 5% above target. */
  deviation: number | null;
  /** pass = comfortably in range · warning = in range but near a limit
   * (15% of range width) · fail = out of range. See src/lib/labQc.ts. */
  status: "pass" | "warning" | "fail";
}

/** A file attached to a sample (e.g. a COA scan, a sample photo). Kept
 * addressable (real _id) so a single attachment can be deleted individually
 * via src/app/api/lab/samples/[id]/attachments/[attachmentId]. */
export interface ILabAttachment {
  _id?: Types.ObjectId;
  fileName: string;
  url: string;
  fileType: string;
  size: number;
  uploadedAt: Date;
  uploadedById?: mongoose.Types.ObjectId | null;
  uploadedByName?: string;
}

export interface ILabSampleDoc extends Document {
  sampleNumber: string;
  /** Set only when this sample was recorded as stage 6 of an order's approval
   *  chain. **Deliberately nullable**: routine production QC — shift sampling,
   *  batch lots, any ad-hoc test — is created straight from the Results tab with
   *  no order attached, and such a sample is a first-class citizen everywhere
   *  (lists, control charts, KPIs, per-customer stats, Excel). Never make this
   *  required. (SPEC §7) */
  orderId?: mongoose.Types.ObjectId | null;
  orderNumber: string;      // denormalized, like `product`/`customer`
  productId: mongoose.Types.ObjectId;
  product: string;          // denormalized product name
  customerId?: mongoose.Types.ObjectId | null;
  customer: string;         // denormalized customer name
  sampleDate: Date;
  /** Production shift the sample was drawn on. */
  shift: "morning" | "afternoon" | "night" | "";
  /** Plant batch / sample ID this test belongs to — the link back to the
   * physical lot, so a customer complaint about a delivery can be traced. */
  batchId: string;
  testedById: mongoose.Types.ObjectId;
  testedByName: string;
  results: ILabSampleResult[];
  overallStatus: "pass" | "warning" | "fail";
  attachments: Types.DocumentArray<ILabAttachment>;
  // Automatic overallStatus (above) is the threshold-based verdict. This is a
  // separate, optional human sign-off — the technical manager may accept a
  // borderline fail with justification, or reject an otherwise-passing
  // sample for other reasons. Admin-only to set (enforced server-side).
  finalDecision: "pending" | "accepted" | "rejected";
  finalDecisionNote?: string;
  finalDecisionById?: mongoose.Types.ObjectId | null;
  finalDecisionByName?: string;
  finalDecisionAt?: Date | null;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LabSampleResultSchema = new Schema<ILabSampleResult>(
  {
    parameterId:   { type: Schema.Types.ObjectId, ref: "LabParameter", required: true },
    parameterName: { type: String, required: true },
    unit:          { type: String, default: "" },
    value:         { type: Number, required: true },
    operator:      { type: String, enum: ["n_m_t", "n_l_t", "range", "none"], required: true },
    min:           { type: Number, default: null },
    max:           { type: Number, default: null },
    target:        { type: Number, default: null },
    deviation:     { type: Number, default: null },
    status:        { type: String, enum: ["pass", "warning", "fail"], required: true },
  },
  { _id: false }
);

const LabAttachmentSchema = new Schema<ILabAttachment>({
  fileName:       { type: String, required: true },
  url:            { type: String, required: true },
  fileType:       { type: String, default: "" },
  size:           { type: Number, default: 0 },
  uploadedAt:     { type: Date, default: Date.now },
  uploadedById:   { type: Schema.Types.ObjectId, ref: "User", default: null },
  uploadedByName: { type: String, default: "" },
});

const LabSampleSchema = new Schema<ILabSampleDoc>(
  {
    sampleNumber: { type: String, required: true, unique: true },
    orderId:      { type: Schema.Types.ObjectId, ref: "SalesOrder", default: null },
    orderNumber:  { type: String, default: "" },
    productId:    { type: Schema.Types.ObjectId, ref: "LabProduct", required: true },
    product:      { type: String, default: "" },
    customerId:   { type: Schema.Types.ObjectId, ref: "LabCustomer", default: null },
    customer:     { type: String, default: "" },
    sampleDate:   { type: Date, required: true },
    shift:        { type: String, enum: ["morning", "afternoon", "night", ""], default: "" },
    batchId:      { type: String, default: "" },
    testedById:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    testedByName: { type: String, default: "" },
    results:       [LabSampleResultSchema],
    overallStatus: { type: String, enum: ["pass", "warning", "fail"], required: true },
    attachments:   [LabAttachmentSchema],
    finalDecision:       { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    finalDecisionNote:   { type: String, default: "" },
    finalDecisionById:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    finalDecisionByName: { type: String, default: "" },
    finalDecisionAt:     { type: Date, default: null },
    notes:         { type: String, default: "" },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

LabSampleSchema.index({ orderId: 1 });   // "which samples belong to this order"
LabSampleSchema.index({ sampleDate: -1 });
LabSampleSchema.index({ productId: 1 });
LabSampleSchema.index({ customerId: 1, sampleDate: -1 }); // per-customer history
LabSampleSchema.index({ batchId: 1 });
LabSampleSchema.index({ overallStatus: 1 });
LabSampleSchema.index({ "results.parameterId": 1 });

export default mongoose.models.LabSample ||
  mongoose.model<ILabSampleDoc>("LabSample", LabSampleSchema);
