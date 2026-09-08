import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, conflict, oid, readJson, str } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import Delegation from "@/models/Delegation";
import User from "@/models/User";

const DELEGABLE_ROLES = Array.from(new Set(SALES_STAGES.map((s) => s.role)));

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { searchParams } = new URL(req.url);
  const now = new Date();

  const filter: Record<string, unknown> = { isActive: true };
  // Only what is in force right now, unless explicitly asked for the history.
  if (searchParams.get("all") !== "true") {
    filter.from = { $lte: now };
    filter.to = { $gte: now };
  }
  // Anyone may see the delegations that concern them; only an admin sees all.
  if (userDoc.role !== "admin" && searchParams.get("scope") !== "all") {
    filter.$or = [{ toUserId: userDoc._id }, { fromUserId: userDoc._id }, { createdById: userDoc._id }];
  }

  const delegations = await Delegation.find(filter).sort({ to: 1 }).limit(200).lean();
  return NextResponse.json({ delegations });
}

/**
 * Appoint a stand-in. The primary may delegate their OWN role; an admin may
 * delegate any. This is authority moving, so it is audited like an approval.
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const role = str(body.role, 40);
  if (!DELEGABLE_ROLES.includes(role as never)) return badRequest("Unknown role");

  const isAdmin = userDoc.role === "admin";
  if (!isAdmin && userDoc.role !== role) {
    return NextResponse.json(
      { error: "You can only hand over your own role" },
      { status: 403 }
    );
  }

  const toUserId = oid(body.toUserId);
  if (!toUserId) return badRequest("A valid toUserId is required");
  if (String(toUserId) === String(userDoc._id)) {
    return badRequest("You cannot delegate to yourself");
  }

  const recipient = (await User.findOne({ _id: toUserId, isActive: true })
    .select("name role").lean()) as { name: string; role: string } | null;
  if (!recipient) return badRequest("Unknown or inactive user");

  const from = new Date(str(body.from, 40) || new Date().toISOString());
  const to = new Date(str(body.to, 40));
  if (Number.isNaN(from.getTime())) return badRequest("Invalid start date");
  // Required on purpose: a delegation with no expiry is a permanent transfer of
  // authority by accident.
  if (Number.isNaN(to.getTime())) return badRequest("An end date is required");
  if (to <= from) return badRequest("The end date must be after the start date");
  if (to < new Date()) return badRequest("The end date is already in the past");

  // Overlapping live delegations would mean two people are both "the delegate"
  // for one role at one moment. Revoke the existing one first.
  const clash = (await Delegation.findOne({
    role, isActive: true,
    from: { $lte: to },
    to: { $gte: from },
  }).lean()) as { toUserName?: string; to?: Date } | null;
  if (clash) {
    return conflict(
      `${role.replace(/_/g, " ")} is already delegated to ${clash.toUserName || "someone"} until ${
        clash.to ? new Date(clash.to).toISOString().slice(0, 10) : "?"
      }`
    );
  }

  const created = await Delegation.create({
    role,
    fromUserId: isAdmin && userDoc.role !== role ? null : userDoc._id,
    toUserId,
    toUserName: recipient.name,
    from, to,
    reason: str(body.reason, 500),
    createdById: userDoc._id,
    createdByName: userDoc.name,
    isActive: true,
  });

  await writeAudit({
    entityType: "delegation",
    entityId: created._id as never,
    entityLabel: `${role} → ${recipient.name}`,
    action: "delegation_created",
    field: role,
    newValue: `${recipient.name} until ${to.toISOString().slice(0, 10)}`,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
    notes: str(body.reason, 500),
  });

  return NextResponse.json(created, { status: 201 });
}
