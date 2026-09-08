import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * One generic, entity-agnostic trail — not a table per entity.
 *
 * `oldValue`/`newValue` are STRINGS on purpose: this is a human-readable
 * record, not a replay log, and coercing everything keeps one shape for orders,
 * delegations, absences and users alike.
 */
export interface IAuditLogDoc extends Document {
  entityType: string;
  entityId: Types.ObjectId;
  /** Human handle for the entity — the order number, the user's name. Saves a
   *  lookup when rendering, and survives the entity being archived. */
  entityLabel: string;
  action: string;
  field: string;
  oldValue: string;
  newValue: string;
  performedBy: string;
  performedByName: string;
  notes: string;
  timestamp: Date;
}

const AuditLogSchema = new Schema<IAuditLogDoc>({
  entityType:  { type: String, required: true, index: true },
  entityId:    { type: Schema.Types.ObjectId, required: true, index: true },
  entityLabel: { type: String, default: "" },
  action:      { type: String, required: true },
  field:       { type: String, default: "" },
  oldValue:    { type: String, default: "" },
  newValue:    { type: String, default: "" },
  performedBy:     { type: String, required: true },
  performedByName: { type: String, required: true },
  notes:     { type: String, default: "" },
  timestamp: { type: Date, default: Date.now, index: true },
});

AuditLogSchema.index({ entityId: 1, timestamp: -1 });
AuditLogSchema.index({ entityType: 1, timestamp: -1 });

export default mongoose.models.AuditLog ||
  mongoose.model<IAuditLogDoc>("AuditLog", AuditLogSchema);
