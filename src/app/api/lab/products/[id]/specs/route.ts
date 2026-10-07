import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import LabProduct from "@/models/LabProduct";
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

  /**
   * Only the tests that apply to THIS product.
   *
   * `productIds` empty means "every product" — the permissive default the
   * catalogue had before it was scoped — so the filter is "unscoped OR
   * explicitly includes me". Without the first branch every pre-existing
   * parameter would vanish from every spec sheet the moment this shipped.
   *
   * ⚠️ `$size: 0`, not `$eq: []`. A parameter saved before the field existed
   * has no `productIds` key at all, and `$size` matches a missing array no
   * more than an empty one — which is why the backfill script has to run, and
   * why `$exists: false` is the third branch rather than an afterthought.
   *
   * A test scoped to this grade's TYPE counts too. "فحوصات الطحين" is one
   * statement about flour, and making QA tick all eight grades to say it would
   * be eight chances to miss one — and eight rows to revisit the day a ninth
   * grade is added.
   */
  const product = (await LabProduct.findOne({ _id: id, isActive: true })
    .select("parentId")
    .lean()) as { parentId?: mongoose.Types.ObjectId | null } | null;
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const scopeIds = [new mongoose.Types.ObjectId(id)];
  if (product.parentId) scopeIds.push(product.parentId);

  const scopedToProduct = {
    isActive: true,
    $or: [
      { productIds: { $exists: false } },
      { productIds: { $size: 0 } },
      { productIds: { $in: scopeIds } },
    ],
  };

  const [parameters, overrides] = await Promise.all([
    LabParameter.find(scopedToProduct).sort({ order: 1, name: 1 }).lean(),
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
