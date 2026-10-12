import mongoose from "mongoose";
import LabProduct from "@/models/LabProduct";
import LabParameter from "@/models/LabParameter";
import LabParameterThreshold from "@/models/LabParameterThreshold";

export interface ResolvedSpec {
  parameterId: string;
  name: string;
  nameAr: string;
  unit: string;
  order: number;
  min: number | null;
  max: number | null;
  target: number | null;
  operator: string;
  hasOverride: boolean;
  overrideId: string | null;
}

/**
 * Every active parameter with its limits already resolved FOR ONE PRODUCT —
 * the same resolution `GET /api/lab/products/[id]/specs` returns, factored
 * out so `copy-from` (src/app/api/lab/products/[id]/specs/copy-from/route.ts)
 * can read a SOURCE product's sheet with the exact same rules, rather than a
 * second, driftable copy of this query.
 *
 * Returns `null` when the product doesn't exist (or isn't active) — the
 * caller decides whether that's a 404.
 */
export async function resolveProductSpecs(productId: string): Promise<ResolvedSpec[] | null> {
  const product = (await LabProduct.findOne({ _id: productId, isActive: true })
    .select("parentId")
    .lean()) as { parentId?: mongoose.Types.ObjectId | null } | null;
  if (!product) return null;

  const scopeIds = [new mongoose.Types.ObjectId(productId)];
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
    LabParameterThreshold.find({ productId, isActive: true }).lean(),
  ]);

  const overrideByParam = new Map(
    overrides.map((o) => [o.parameterId.toString(), o])
  );

  return parameters.map((p) => {
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
}
