import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import Delegation from "@/models/Delegation";

/** Revoke. Immediate, and audited — the recipient loses the role on their very
 *  next request, since authority is resolved per request, never cached. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const delegation = (await Delegation.findOne({ _id: id, isActive: true }).lean()) as
    { _id: unknown; role: string; toUserName: string; fromUserId?: unknown } | null;
  if (!delegation) return notFound("Delegation not found");

  const isAdmin = userDoc.role === "admin";
  const isOwner = String(delegation.fromUserId ?? "") === String(userDoc._id);
  if (!isAdmin && !isOwner && userDoc.role !== delegation.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await Delegation.updateOne({ _id: id }, { $set: { isActive: false } });

  await writeAudit({
    entityType: "delegation",
    entityId: id,
    entityLabel: `${delegation.role} → ${delegation.toUserName}`,
    action: "delegation_revoked",
    field: delegation.role,
    oldValue: delegation.toUserName,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
  });

  return NextResponse.json({ success: true });
}
