import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import { badRequest, oid, readJson, str } from "@/lib/apiHelpers";
import LabProduct from "@/models/LabProduct";

/**
 * The whole catalogue — types and grades together, each carrying how many
 * active grades sit under it.
 *
 * The count is computed HERE, once, rather than left to the five screens that
 * consume this list. "Is this orderable" is the same question on the order
 * dialog, the sample form, the specs screen, the lab step dialog and the
 * report filter, and five independent derivations of it is five chances to
 * offer "طحين" as something the warehouse can fill.
 */
export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const products = (await LabProduct.find({ isActive: true })
    .sort({ name: 1 })
    .lean()) as unknown as { _id: unknown; parentId?: unknown }[];

  const childCount = new Map<string, number>();
  for (const p of products) {
    if (!p.parentId) continue;
    const key = String(p.parentId);
    childCount.set(key, (childCount.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    products: products.map((p) => ({
      ...p,
      childCount: childCount.get(String(p._id)) ?? 0,
    })),
  });
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

  /**
   * A grade (صنف) names the type it belongs to; a type (نوع منتج) names
   * nothing. The catalogue is deliberately two levels deep and no more — the
   * plant has types and grades of them, and a third level would be a shape
   * the picker, the spec sheet and the order line have no vocabulary for.
   */
  let parentId: ReturnType<typeof oid> = null;
  let inherited = body.orderRequiresLabTest !== false;

  if (body.parentId) {
    parentId = oid(body.parentId);
    if (!parentId) return badRequest("Invalid parentId");

    const parent = (await LabProduct.findOne({ _id: parentId, isActive: true })
      .select("parentId orderRequiresLabTest")
      .lean()) as { parentId?: unknown; orderRequiresLabTest?: boolean } | null;
    if (!parent) return badRequest("Unknown product type");
    if (parent.parentId) return badRequest("A grade cannot have grades of its own");

    // Not taken from the client: whether an order needs a lab test is a fact
    // about the TYPE, and a grade that disagreed with its own type would put
    // two orders of flour on two different routes.
    inherited = parent.orderRequiresLabTest !== false;
  }

  const created = await LabProduct.create({
    name,
    nameAr: str(body.nameAr, 120),
    parentId,
    // Absent means tested — the stricter default, matching the schema. A
    // product added in a hurry waits for a test it may not need (a visible
    // delay) rather than skipping one it did (a shipped defect).
    orderRequiresLabTest: inherited,
    isActive: true,
  });
  return NextResponse.json(created, { status: 201 });
}
