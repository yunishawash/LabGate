import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson } from "@/lib/apiHelpers";
import LabProduct from "@/models/LabProduct";
import LabParameter from "@/models/LabParameter";
import LabParameterThreshold from "@/models/LabParameterThreshold";
import { resolveProductSpecs } from "@/lib/labSpecs";

type Params = { params: Promise<{ id: string }> };

/**
 * Clones a product's whole spec sheet onto another one — client request,
 * 2026-10-12: a brand-new grade under a brand-new type starts with NOTHING,
 * because every existing test is scoped to the types it was written for (see
 * the scope comment on `resolveProductSpecs`), and ticking each one by hand
 * on the parameter screen is exactly the "from scratch" work this exists to
 * skip.
 *
 * Two things happen per parameter on the SOURCE's resolved sheet:
 *
 *  1. SCOPE — if the parameter doesn't already cover the target (and isn't
 *     already unscoped/global), the target's own id is added to its
 *     `productIds`. This is the only way to make an existing, possibly
 *     widely-shared parameter apply to a product it didn't before; it is
 *     scoped to the target's own id, not its type, so copying onto one new
 *     grade does not silently widen the test to every future grade of that
 *     type.
 *
 *  2. VALUES — only when the source itself has a product-specific override
 *     (`hasOverride`). A source using the plant default is left to the
 *     target using the plant default too, so the two stay in sync if that
 *     default is later tuned; an override is a deliberate per-product
 *     deviation, and that deviation is what gets copied. The target's OWN
 *     existing override, if any, is never touched — a repeat copy (or a
 *     copy onto a partially-configured product) never clobbers something
 *     already entered here on purpose.
 */
export async function POST(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  const targetId = oid(id);
  if (!targetId) return badRequest("Invalid product id");

  const body = await readJson(req);
  const sourceId = oid(body?.sourceProductId);
  if (!sourceId) return badRequest("A valid sourceProductId is required");
  if (sourceId.equals(targetId)) return badRequest("A product cannot copy its spec from itself");

  const [target, source] = await Promise.all([
    LabProduct.findOne({ _id: targetId, isActive: true }).select("parentId").lean(),
    LabProduct.findOne({ _id: sourceId, isActive: true }).select("_id").lean(),
  ]);
  if (!target) return notFound("Product not found");
  if (!source) return badRequest("Unknown source product");

  const sourceSpecs = await resolveProductSpecs(String(sourceId));
  if (sourceSpecs === null) return badRequest("Unknown source product");
  if (!sourceSpecs.length) {
    return NextResponse.json({ scopedCount: 0, copiedValueCount: 0 });
  }

  const targetScopeIds = [targetId, ...(target.parentId ? [target.parentId] : [])].map(String);

  const existingTargetOverrides = new Set(
    (
      await LabParameterThreshold.find({ productId: targetId, isActive: true })
        .select("parameterId")
        .lean()
    ).map((o) => o.parameterId.toString())
  );

  let scopedCount = 0;
  let copiedValueCount = 0;

  for (const spec of sourceSpecs) {
    const param = await LabParameter.findById(spec.parameterId).select("productIds").lean();
    if (!param) continue; // raced — removed since resolveProductSpecs read it

    const scope: string[] = (param.productIds ?? []).map(String);
    const alreadyCoversTarget = scope.length === 0 || scope.some((s: string) => targetScopeIds.includes(s));
    if (!alreadyCoversTarget) {
      await LabParameter.updateOne(
        { _id: spec.parameterId },
        { $addToSet: { productIds: targetId } }
      );
      scopedCount++;
    }

    if (spec.hasOverride && !existingTargetOverrides.has(spec.parameterId)) {
      await LabParameterThreshold.findOneAndUpdate(
        { parameterId: new mongoose.Types.ObjectId(spec.parameterId), productId: targetId },
        {
          $set: {
            min: spec.min,
            max: spec.max,
            target: spec.target,
            operator: spec.operator,
            isActive: true,
          },
        },
        { upsert: true }
      );
      copiedValueCount++;
    }
  }

  return NextResponse.json({ scopedCount, copiedValueCount });
}
