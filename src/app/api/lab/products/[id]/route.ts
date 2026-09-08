import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, conflict, isDuplicateKeyError } from "@/lib/apiHelpers";
import LabProduct from "@/models/LabProduct";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const update: Record<string, unknown> = {};
  if ("name" in body) {
    const name = str(body.name, 120);
    if (!name) return badRequest("A product name is required");
    update.name = name;
  }
  if ("nameAr" in body) update.nameAr = str(body.nameAr, 120);

  // A rename can collide with another row's unique name. Surface that as a
  // readable 409 rather than letting a raw E11000 escape as a 500.
  let updated;
  try {
    updated = await LabProduct.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: update },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${update.name}" is already in use`);
    throw err;
  }

  if (!updated) return notFound("Product not found");
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await LabProduct.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();

  if (!updated) return notFound("Product not found");
  return NextResponse.json({ success: true });
}
