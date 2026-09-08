import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import AuditLog from "@/models/AuditLog";

export interface AuditParams {
  entityType: "sales_order" | "delegation" | "user" | "lab_sample";
  entityId: mongoose.Types.ObjectId | string;
  entityLabel?: string;
  action: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  performedBy: mongoose.Types.ObjectId | string;
  performedByName: string;
  notes?: string;
}

/**
 * Write one audit entry. Never throws into the caller: an approval must not
 * fail because its trail could not be written — but the failure is logged
 * loudly rather than swallowed, because a silent gap in an audit trail is worse
 * than a noisy one.
 */
export async function writeAudit(params: AuditParams): Promise<void> {
  try {
    await connectDB();
    await AuditLog.create({
      entityType: params.entityType,
      entityId: new mongoose.Types.ObjectId(String(params.entityId)),
      entityLabel: params.entityLabel ?? "",
      action: params.action,
      field: params.field ?? "",
      oldValue: params.oldValue === undefined || params.oldValue === null ? "" : String(params.oldValue),
      newValue: params.newValue === undefined || params.newValue === null ? "" : String(params.newValue),
      performedBy: String(params.performedBy),
      performedByName: params.performedByName || "System",
      notes: params.notes ?? "",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[audit] FAILED to record:", params.entityType, params.action, err);
  }
}
