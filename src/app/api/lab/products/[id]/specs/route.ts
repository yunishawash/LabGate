import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import LabParameter from "@/models/LabParameter";
import LabParameterThreshold from "@/models/LabParameterThreshold";

/**
 * Every active parameter with its limits already resolved FOR THIS PRODUCT —
 * the per-product spec sheet. Backs the product-centric editor: pick a
 * product, see and edit its whole spec in one place, instead of hunting
 * through a flat global list of overrides.
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

  const [parameters, overrides] = await Promise.all([
    LabParameter.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
    LabParameterThreshold.find({ productId: id, isActive: true }).lean(),
  ]);

  const overrideByParam = new Map(
    overrides.map((o) => [o.parameterId.toString(), o])
  );

  const specs = parameters.map((p) => {
    const o = overrideByParam.get(p._id.toString());
    return {
      parameterId: p._id.toString(),
      name: p.name,
      nameAr: p.nameAr ?? "",
      unit: p.unit,
      order: p.order,
      min:      o ? o.min ?? null    : p.defaultMin ?? null,
      max:      o ? o.max ?? null    : p.defaultMax ?? null,
      target:   o ? o.target ?? null : p.defaultTarget ?? null,
      operator: o?.operator ?? p.operator,
      hasOverride: !!o,
      overrideId: o?._id?.toString() ?? null,
    };
  });

  return NextResponse.json({ specs });
}
