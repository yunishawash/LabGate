import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import { badRequest, readJson, str } from "@/lib/apiHelpers";
import LabProduct from "@/models/LabProduct";

export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const products = await LabProduct.find({ isActive: true }).sort({ name: 1 }).lean();
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const name = str(body.name, 120);
  if (!name) return badRequest("A product name is required");

  const exists = await LabProduct.findOne({ name }).lean();
  if (exists) return badRequest(`A product named "${name}" already exists`);

  const created = await LabProduct.create({
    name,
    nameAr: str(body.nameAr, 120),
    isActive: true,
  });
  return NextResponse.json(created, { status: 201 });
}
