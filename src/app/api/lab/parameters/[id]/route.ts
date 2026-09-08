import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, numOrNull, oneOf, conflict, isDuplicateKeyError } from "@/lib/apiHelpers";
import LabParameter from "@/models/LabParameter";
import { LAB_OPERATORS } from "@/lib/labConstants";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  // Whitelist, never `$set: body`. Only fields actually present are touched, so
  // a partial update does not blank the rest of the document.
  const update: Record<string, unknown> = {};
  if ("name" in body) {
    const name = str(body.name, 120);
    if (!name) return badRequest("A parameter name is required");
    update.name = name;
  }
  if ("nameAr" in body) update.nameAr = str(body.nameAr, 120);
  if ("unit" in body) update.unit = str(body.unit, 30);
  if ("operator" in body) update.operator = oneOf(body.operator, LAB_OPERATORS, "none");
  if ("defaultMin" in body) update.defaultMin = numOrNull(body.defaultMin);
  if ("defaultMax" in body) update.defaultMax = numOrNull(body.defaultMax);
  if ("defaultTarget" in body) update.defaultTarget = numOrNull(body.defaultTarget);
  if ("order" in body) update.order = numOrNull(body.order) ?? 0;

  // A rename can collide with another row's unique name. Surface that as a
  // readable 409 rather than letting a raw E11000 escape as a 500.
  let updated;
  try {
    updated = await LabParameter.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: update },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${update.name}" is already in use`);
    throw err;
  }

  if (!updated) return notFound("Parameter not found");
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await LabParameter.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();

  if (!updated) return notFound("Parameter not found");
  return NextResponse.json({ success: true });
}
