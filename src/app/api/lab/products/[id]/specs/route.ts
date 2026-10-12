import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { resolveProductSpecs } from "@/lib/labSpecs";

/**
 * Every active parameter with its limits already resolved FOR THIS PRODUCT —
 * the per-product spec sheet. Backs the product-centric editor: pick a
 * product, see and edit its whole spec in one place, instead of hunting
 * through a flat global list of overrides.
 *
 * The resolution itself (scope rules, override lookup) lives in
 * `resolveProductSpecs` — shared with `copy-from`, which reads a SOURCE
 * product's sheet the same way before copying it onto another.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  const specs = await resolveProductSpecs(id);
  if (specs === null) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  return NextResponse.json({ specs });
}
