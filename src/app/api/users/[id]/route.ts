import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, conflict, isDuplicateKeyError, notFound, oid, oneOf, readJson, str } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import { USER_ROLES } from "@/types";
import { ALL_PERMISSIONS } from "@/lib/modules";
import User from "@/models/User";

type Params = { params: Promise<{ id: string }> };
const COST = 12;

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const existing = await User.findById(id).lean() as
    | { _id: unknown; name: string; role: string; isActive: boolean }
    | null;
  if (!existing) return notFound("User not found");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const update: Record<string, unknown> = {};
  if ("name" in body) update.name = str(body.name, 120);
  if ("nameAr" in body) update.nameAr = str(body.nameAr, 120);
  if ("email" in body) {
    const email = str(body.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest("A valid email is required");
    update.email = email;
  }
  if ("role" in body) update.role = oneOf(body.role, USER_ROLES, existing.role);
  if ("permissions" in body) {
    update.permissions = Array.isArray(body.permissions)
      ? (body.permissions as unknown[]).map(String).filter((p) => ALL_PERMISSIONS.includes(p))
      : [];
  }
  if ("isActive" in body) update.isActive = body.isActive !== false;

  /**
   * Never through `.save()`. The password field is written with
   * `findByIdAndUpdate` everywhere in this codebase precisely so that adding a
   * pre-save hook later cannot silently double-hash it.
   */
  if (body.password) {
    const pw = str(body.password, 200);
    if (pw.length < 6) return badRequest("The password must be at least 6 characters");
    update.password = await bcrypt.hash(pw, COST);
  }

  if (!Object.keys(update).length) return badRequest("Nothing to update");

  // Deactivating the last active holder of a chain role strands every order
  // sitting at that stage — say so before it happens rather than after.
  if (update.isActive === false && existing.isActive) {
    const others = await User.countDocuments({
      role: existing.role, isActive: true, _id: { $ne: id },
    });
    if (others === 0 && body.confirmSoleHolder !== true) {
      return conflict(
        `${existing.name} is the only active ${existing.role}. Deactivating them stops every order at that stage.`
      );
    }
  }

  try {
    const updated = await User.findByIdAndUpdate(id, { $set: update }, { new: true })
      .select("-password").lean();

    /**
     * A role change grants or revokes signing power, which is why it is audited
     * as its own action rather than folded into a generic "updated" (SPEC §14.6).
     */
    if (update.role && update.role !== existing.role) {
      await writeAudit({
        entityType: "user", entityId: id, entityLabel: existing.name,
        action: "role_changed", field: "role",
        oldValue: existing.role, newValue: update.role as string,
        performedBy: userDoc._id, performedByName: userDoc.name,
      });
    }
    if (update.password) {
      await writeAudit({
        entityType: "user", entityId: id, entityLabel: existing.name,
        action: "password_reset", field: "password",
        performedBy: userDoc._id, performedByName: userDoc.name,
      });
    }
    if ("isActive" in update && update.isActive !== existing.isActive) {
      await writeAudit({
        entityType: "user", entityId: id, entityLabel: existing.name,
        action: update.isActive ? "activated" : "deactivated", field: "isActive",
        oldValue: String(existing.isActive), newValue: String(update.isActive),
        performedBy: userDoc._id, performedByName: userDoc.name,
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict("That email is already in use");
    throw err;
  }
}

/**
 * Deactivate, never delete. Every signature in the chain points at a user id;
 * removing the row would leave approvals attributed to nobody, which is exactly
 * the hole an audit trail exists to close.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");
  if (String(id) === String(userDoc._id)) {
    return badRequest("You cannot deactivate your own account");
  }

  const updated = await User.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
    .select("-password").lean();
  if (!updated) return notFound("User not found");

  await writeAudit({
    entityType: "user", entityId: id,
    entityLabel: (updated as { name: string }).name,
    action: "deactivated", field: "isActive",
    oldValue: "true", newValue: "false",
    performedBy: userDoc._id, performedByName: userDoc.name,
  });

  return NextResponse.json({ deactivated: true });
}
