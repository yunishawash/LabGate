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

  const order = await SalesOrder.findById(orderId).select("orderNumber steps").lean();
  if (!order) return notFound("Order not found");

  // The Collections note IS the thing the Finance Manager approved — letting
  // it change afterward would mean his signature no longer matches what it
  // signed off on. Admin keeps the ability to fix a mistake either way.
  if (kind === "collections" && userDoc.role !== "admin") {
    const steps = (order as unknown as { steps?: { stageKey: string; status: string }[] }).steps || [];
    const financeStep = steps.find((s) => s.stageKey === "finance_manager_approval");
    if (financeStep?.status === "approved" || financeStep?.status === "completed") {
      return badRequest(
        "The Finance Manager has already approved this order — the Collections note can no longer be changed."
      );
    }
  }

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
