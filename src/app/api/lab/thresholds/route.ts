import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import { badRequest, oid, readJson, numOrNull, oneOf } from "@/lib/apiHelpers";
import LabParameterThreshold from "@/models/LabParameterThreshold";
import LabParameter from "@/models/LabParameter";
import LabProduct from "@/models/LabProduct";
import { LAB_OPERATORS } from "@/lib/labConstants";

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  const parameterId = searchParams.get("parameterId");

  const filter: Record<string, unknown> = { isActive: true };
  if (parameterId) {
    const pid = oid(parameterId);
    if (!pid) return badRequest("Invalid parameterId");
    filter.parameterId = pid;
  }

  const thresholds = await LabParameterThreshold.find(filter)
    .populate("productId", "name")
    .lean();
  return NextResponse.json({ thresholds });
}

/**
 * Upsert keyed on (parameterId, productId) — editing an existing override
 * re-POSTs the same pair rather than needing a separate edit endpoint.
 *
 * Note the unique index does NOT include `isActive`, so a soft-deleted override
 * still occupies the pair; flipping `isActive: true` here is what revives it.
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const parameterId = oid(body.parameterId);
  const productId = oid(body.productId);
  if (!parameterId || !productId) return badRequest("A valid parameterId and productId are required");

  // Both must actually exist — otherwise a typo silently creates an override
  // that will never resolve against anything.
  const [param, product] = await Promise.all([
    LabParameter.findOne({ _id: parameterId, isActive: true }).select("_id").lean(),
    LabProduct.findOne({ _id: productId, isActive: true }).select("_id").lean(),
  ]);
  if (!param) return badRequest("Unknown parameter");
  if (!product) return badRequest("Unknown product");

  const min = numOrNull(body.min);
  const max = numOrNull(body.max);
  if (min !== null && max !== null && min > max) {
    return badRequest("Minimum cannot be greater than maximum");
  }

  const updated = await LabParameterThreshold.findOneAndUpdate(
    { parameterId, productId },
    {
      $set: {
        min,
        max,
        target: numOrNull(body.target),
        operator: body.operator ? oneOf(body.operator, LAB_OPERATORS, "none") : null,
        isActive: true,
      },
    },
    { new: true, upsert: true }
  ).lean();

  return NextResponse.json(updated, { status: 201 });
}
