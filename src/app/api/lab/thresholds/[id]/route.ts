import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import LabParameterThreshold from "@/models/LabParameterThreshold";

/** Removing an override makes the product fall back to the parameter default. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await LabParameterThreshold.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();

  if (!updated) return notFound("Threshold not found");
  return NextResponse.json({ success: true });
}
