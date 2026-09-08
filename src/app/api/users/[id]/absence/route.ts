import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession, isUserAbsent } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import { stageByKey, SALES_STAGES } from "@/lib/salesWorkflow";
import User from "@/models/User";

/**
 * Mark someone away, or bring them back.
 *
 * This is the switch that unlocks a deputy's signature, so it is audited as
 * carefully as an approval — and the response says WHO gains authority as a
 * result, because the commonest failure here is a person flipping it without
 * realising what it hands over.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  // Your own absence, or anyone's if you are an admin.
  const isSelf = String(id) === String(userDoc._id);
  if (!isSelf && userDoc.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const target = (await User.findOne({ _id: id, isActive: true })
    .select("name role isAbsent absentFrom absentTo").lean()) as
    { name: string; role: string; isAbsent: boolean; absentFrom: Date | null; absentTo: Date | null } | null;
  if (!target) return notFound("User not found");

  const isAbsent = body.isAbsent === true;

  let absentFrom: Date | null = null;
  let absentTo: Date | null = null;
  if (body.absentFrom) {
    absentFrom = new Date(str(body.absentFrom, 40));
    if (Number.isNaN(absentFrom.getTime())) return badRequest("Invalid absentFrom");
  }
  if (body.absentTo) {
    absentTo = new Date(str(body.absentTo, 40));
    if (Number.isNaN(absentTo.getTime())) return badRequest("Invalid absentTo");
    // End of that day, so "away until the 12th" includes the 12th.
    absentTo.setHours(23, 59, 59, 999);
  }
  if (absentFrom && absentTo && absentTo < absentFrom) {
    return badRequest("The return date must be after the start date");
  }

  const wasAbsent = isUserAbsent(target);

  await User.updateOne(
    { _id: id },
    { $set: { isAbsent, absentFrom, absentTo, absenceNote: str(body.absenceNote, 300) } }
  );

  const nowAbsent = isUserAbsent({ isAbsent, absentFrom, absentTo });

  if (wasAbsent !== nowAbsent) {
    await writeAudit({
      entityType: "user",
      entityId: id,
      entityLabel: target.name,
      action: nowAbsent ? "marked_away" : "marked_back",
      field: "absence",
      oldValue: wasAbsent ? "away" : "present",
      newValue: nowAbsent ? "away" : "present",
      performedBy: userDoc._id,
      performedByName: userDoc.name,
      notes: str(body.absenceNote, 300),
    });
  }

  // Say plainly what this hands over. A deputy only opens for stages that HAVE
  // one — stages 5, 7 and 8 stall instead, by the client's decision.
  const covered = SALES_STAGES.filter((s) => s.role === target.role);
  const consequences = covered.map((s) => ({
    stageKey: s.key,
    stageIndex: s.index,
    stage: { en: s.en, ar: s.ar },
    deputyRole: s.deputyRole ?? null,
    stalls: !s.deputyRole,
  }));

  return NextResponse.json({
    success: true,
    isAbsent: nowAbsent,
    absentFrom,
    absentTo,
    role: target.role,
    consequences,
  });
}

export { stageByKey };
