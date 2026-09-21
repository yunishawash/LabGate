import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import SalesOrder from "@/models/SalesOrder";

/**
 * Collections (التحصيلات) and Packing (التعبئة) notes printed on the MS-SC/F7
 * form. Plain subdocuments, not chain stages — neither gates the order, so
 * writing one is a small guarded PATCH, not a workflow transition. See the
 * rationale on `ISalesOrderDoc.collections`/`.packing` in the model.
 */
const KIND_ROLES: Record<string, string[]> = {
  collections: ["accountant", "finance_manager"],
  packing: ["weighbridge"],
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const { id } = await params;
  const orderId = oid(id);
  if (!orderId) return badRequest("Invalid id");

  const body = await readJson(req);
  const kind = body?.kind;
  if (kind !== "collections" && kind !== "packing") {
    return badRequest("kind must be 'collections' or 'packing'");
  }

  const check = await requireRole(...KIND_ROLES[kind]);
  if (check.error) return check.error;
  const { userDoc } = check;

  const noteCheck = strictStr(body?.note, 2000, "Note");
  if (!noteCheck.ok) return badStrictStr(noteCheck);

  const order = await SalesOrder.findById(orderId).select("orderNumber").lean();
  if (!order) return notFound("Order not found");

  const now = new Date();
  const update = {
    [`${kind}.note`]: noteCheck.value,
    [`${kind}.byId`]: userDoc._id,
    [`${kind}.byName`]: userDoc.name,
    [`${kind}.at`]: now,
  };
  await SalesOrder.updateOne({ _id: orderId }, { $set: update });

  await writeAudit({
    entityType: "sales_order",
    entityId: String(orderId),
    entityLabel: (order as unknown as { orderNumber: string }).orderNumber,
    action: `${kind}_note`,
    field: kind,
    oldValue: "",
    newValue: noteCheck.value,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
    notes: "",
  });

  return NextResponse.json({ ok: true, kind, note: noteCheck.value, byName: userDoc.name, at: now });
}
