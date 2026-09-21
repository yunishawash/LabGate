import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, str, strictStr, oneOf } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import LabProduct from "@/models/LabProduct";
import LabCustomer from "@/models/LabCustomer";
import { scoreResults } from "@/lib/labScore";
import { notifyLabFail } from "@/lib/labNotify";
import { LAB_SHIFTS, LAB_DECISIONS } from "@/lib/labConstants";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const sample = await LabSample.findOne({ _id: id, isActive: true }).lean();
  if (!sample) return notFound("Sample not found");
  return NextResponse.json(sample);
}

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const existing = await LabSample.findOne({ _id: id, isActive: true });
  if (!existing) return notFound("Sample not found");

  const update: Record<string, unknown> = {};

  if ("productId" in body) {
    const pid = oid(body.productId);
    if (!pid) return badRequest("Invalid productId");
    const product = (await LabProduct.findOne({ _id: pid, isActive: true }).select("name").lean()) as
      { name?: string } | null;
    if (!product) return badRequest("Unknown product");
    update.productId = pid;
    update.product = product.name || "";
  }

  if ("customerId" in body) {
    const cid = body.customerId ? oid(body.customerId) : null;
    if (body.customerId && !cid) return badRequest("Invalid customerId");
    if (cid) {
      const customer = (await LabCustomer.findOne({ _id: cid, isActive: true }).select("name").lean()) as
        { name?: string } | null;
      if (!customer) return badRequest("Unknown customer");
      update.customerId = cid;
      update.customer = customer.name || "";
    } else {
      update.customerId = null;
      update.customer = "";
    }
  }

  if ("sampleDate" in body) {
    const d = new Date(str(body.sampleDate, 40));
    if (Number.isNaN(d.getTime())) return badRequest("Invalid sampleDate");
    update.sampleDate = d;
  }
  if ("shift" in body) update.shift = oneOf(body.shift, LAB_SHIFTS, "");
  if ("batchId" in body) update.batchId = str(body.batchId, 80);
  if ("notes" in body) {
    const notesCheck = strictStr(body.notes, 5000, "Notes");
    if (!notesCheck.ok) return badStrictStr(notesCheck);
    update.notes = notesCheck.value;
  }

  // Re-score whenever readings change, against whichever product now applies.
  let newOverall: string | null = null;
  if (Array.isArray(body.results)) {
    const clean: { parameterId: string; value: number }[] = [];
    for (const r of body.results) {
      const row = r as { parameterId?: unknown; value?: unknown };
      const pid = oid(row.parameterId);
      const value = Number(row.value);
      if (!pid) return badRequest("Every result needs a valid parameterId");
      if (!Number.isFinite(value)) return badRequest("Every result must be a finite number");
      clean.push({ parameterId: String(pid), value });
    }
    if (!clean.length) return badRequest("At least one result is required");

    const productId = String(update.productId ?? existing.productId);
    const scored = await scoreResults(productId, clean);
    update.results = scored.results;
    update.overallStatus = scored.overallStatus;
    newOverall = scored.overallStatus;
  }

  const canDecide = userDoc.role === "admin" || userDoc.role === "technical_manager";
  if ("finalDecision" in body && canDecide) {
    const decision = oneOf(body.finalDecision, LAB_DECISIONS, "pending");
    const decisionNoteCheck = strictStr(body.finalDecisionNote, 2000, "Sign-off note");
    if (!decisionNoteCheck.ok) return badStrictStr(decisionNoteCheck);
    update.finalDecision = decision;
    update.finalDecisionNote = decisionNoteCheck.value;
    update.finalDecisionById = decision === "pending" ? null : userDoc._id;
    update.finalDecisionByName = decision === "pending" ? "" : userDoc.name;
    update.finalDecisionAt = decision === "pending" ? null : new Date();
  }

  const updated = await LabSample.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: update },
    { new: true }
  ).lean();
  if (!updated) return notFound("Sample not found");

  // Alert only when this edit NEWLY puts the sample out of range — re-saving an
  // already-failing sample should not re-notify everyone.
  if (newOverall === "fail" && existing.overallStatus !== "fail") {
    notifyLabFail(updated as never).catch((err) => console.error("[samples PUT]", err));
  }

  return NextResponse.json(updated);
}

/**
 * Soft-delete. In the CMMS this handler had NO auth check at all — anyone who
 * could reach the port could delete any QC record.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await LabSample.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();

  if (!updated) return notFound("Sample not found");
  return NextResponse.json({ success: true });
}
