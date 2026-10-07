import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import {
  badRequest, conflict, isDuplicateKeyError, numOrNull, readJson, str,
} from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import RejectionReason from "@/models/RejectionReason";

/**
 * Reading the list is harmless for any signed-in user — the reject dialog
 * needs it, and so will the rejection report.
 */
export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const reasons = await RejectionReason.find({ isActive: true })
    .sort({ order: 1, label: 1 })
    .lean();
  return NextResponse.json({ reasons });
}

/**
 * ADMIN ONLY — the client's explicit rule, and not merely a tidiness
 * preference. This list is the vocabulary the Technical Manager is allowed to
 * kill an order in. Letting him extend it himself would hand him a way around
 * the one thing a closed list buys: that "البضاعة غير متوفرة" is one fact in
 * the report rather than twelve spellings of one.
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const label = str(body.label, 160);
  if (!label) return badRequest("A reason label is required");

  let created;
  try {
    created = await RejectionReason.create({
      label,
      labelAr: str(body.labelAr, 160),
      order: numOrNull(body.order) ?? 0,
      isActive: true,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${label}" is already in the list`);
    throw err;
  }

  const doc = created as unknown as { _id: unknown; label: string };
  await writeAudit({
    entityType: "rejection_reason",
    entityId: String(doc._id),
    entityLabel: doc.label,
    action: "created",
    field: "label",
    oldValue: "",
    newValue: doc.label,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
  });

  return NextResponse.json(created, { status: 201 });
}
