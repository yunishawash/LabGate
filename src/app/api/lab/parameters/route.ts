import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import { badRequest, readJson, str, numOrNull, oneOf, oid } from "@/lib/apiHelpers";
import LabParameter from "@/models/LabParameter";
import { LAB_OPERATORS } from "@/lib/labConstants";

/**
 * Which products a test applies to.
 *
 * An empty array means every product — the permissive default the flat
 * catalogue had — so a missing or unparseable list is NOT an error here, it is
 * "unscoped". Junk ids are dropped rather than 400ing for the same reason
 * `oidList` drops them in a multi-select filter: one stray id should not
 * reject the whole parameter.
 */
function parseProductIds(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Map(
      value
        .map((v) => oid(v))
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .map((v) => [String(v), v])
    ).values()
  );
}

/** Reading the catalogue is harmless for any signed-in user — the sample form,
 *  the specs screen and the order dialog all need it. */
export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const parameters = await LabParameter.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .lean();
  return NextResponse.json({ parameters });
}

/**
 * Editing the catalogue changes how every FUTURE sample is judged, so it is
 * restricted to the lab and the technical manager (admin passes automatically).
 * The CMMS version had no auth at all and passed the raw body to create().
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const name = str(body.name, 120);
  if (!name) return badRequest("A parameter name is required");

  const exists = await LabParameter.findOne({ name }).lean();
  if (exists) return badRequest(`A parameter named "${name}" already exists`);

  const created = await LabParameter.create({
    name,
    nameAr: str(body.nameAr, 120),
    unit: str(body.unit, 30),
    operator: oneOf(body.operator, LAB_OPERATORS, "none"),
    defaultMin: numOrNull(body.defaultMin),
    defaultMax: numOrNull(body.defaultMax),
    defaultTarget: numOrNull(body.defaultTarget),
    productIds: parseProductIds(body.productIds),
    order: numOrNull(body.order) ?? 0,
    isActive: true,
  });

  return NextResponse.json(created, { status: 201 });
}
