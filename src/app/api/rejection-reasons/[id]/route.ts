import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import {
  badRequest, conflict, isDuplicateKeyError, notFound, numOrNull, oid, readJson, str,
} from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import RejectionReason from "@/models/RejectionReason";
import SalesOrder from "@/models/SalesOrder";

type Params = { params: Promise<{ id: string }> };

/** ADMIN ONLY — see the note on POST in the parent route. */
export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const before = (await RejectionReason.findOne({ _id: id, isActive: true })
    .select("label")
    .lean()) as { label?: string } | null;
  if (!before) return notFound("Reason not found");

  // Whitelist, never `$set: body`.
  const update: Record<string, unknown> = {};
  if ("label" in body) {
    const label = str(body.label, 160);
    if (!label) return badRequest("A reason label is required");
    update.label = label;
  }
  if ("labelAr" in body) update.labelAr = str(body.labelAr, 160);
  if ("order" in body) update.order = numOrNull(body.order) ?? 0;

  let updated;
  try {
    updated = await RejectionReason.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: update },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${update.label}" is already in the list`);
    throw err;
  }
  if (!updated) return notFound("Reason not found");

  /**
   * Rewording a reason does NOT rewrite the orders already rejected under it —
   * they keep the `reasonLabel` they were killed with. That is the point of
   * denormalizing it, and it is why this edit is audited: the list says one
   * thing today and the closed orders say another, and the trail is where the
   * two are reconciled.
   */
  await writeAudit({
    entityType: "rejection_reason",
    entityId: id,
    entityLabel: String((updated as { label?: string }).label ?? ""),
    action: "updated",
    field: "label",
    oldValue: before.label ?? "",
    newValue: String((updated as { label?: string }).label ?? ""),
    performedBy: userDoc._id,
    performedByName: userDoc.name,
  });

  return NextResponse.json(updated);
}

/**
 * Retire a reason. ADMIN ONLY, and a soft delete — the rows are what the
 * rejection report groups by, so removing one for real would drop its orders
 * out of the grouping rather than merely stopping new ones being filed under
 * it.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  /**
   * Refuse to empty the list.
   *
   * The Technical Manager MUST pick a reason, so a list of zero would lock
   * him out of rejecting anything at all — a configuration screen that can
   * quietly disable a stage of the approval chain. Checked before the write,
   * and the count is of the OTHER active rows.
   */
  const othersLeft = await RejectionReason.countDocuments({
    _id: { $ne: id },
    isActive: true,
  });
  if (othersLeft === 0) {
    return conflict(
      "This is the last rejection reason. The Technical Manager must have at least one to choose from — add another before retiring this."
    );
  }

  const updated = (await RejectionReason.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } },
    { new: true }
  ).lean()) as { label?: string } | null;
  if (!updated) return notFound("Reason not found");

  // How many closed orders still point at it — the one number that tells an
  // administrator whether this retirement is tidying up or hiding history.
  const usedBy = await SalesOrder.countDocuments({ "rejection.reasonId": id });

  await writeAudit({
    entityType: "rejection_reason",
    entityId: id,
    entityLabel: updated.label ?? "",
    action: "deleted",
    field: "isActive",
    oldValue: true,
    newValue: false,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
    notes: usedBy ? `${usedBy} rejected order(s) still reference this reason` : "",
  });

  return NextResponse.json({ success: true, usedBy });
}
