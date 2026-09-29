import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import AuditLog from "@/models/AuditLog";
import { buildOrderFormHtml } from "@/lib/pdf/orderFormTemplate";
import { htmlToPdf } from "@/lib/pdf/browser";

type Params = { params: Promise<{ id: string }> };

/** MS-SC/F7 — the official paper Sales Order form, rendered server-side. */
export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  // Same visibility rule as the detail route: an order this actor may not
  // see must 404, not print.
  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  // Same feed and order as the "History" tab — see that route's own comment
  // on why visibility is checked against the order, not the log.
  const history = await AuditLog.find({ entityType: "sales_order", entityId: id })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean();

  const html = buildOrderFormHtml(order as never, history as never);

  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html);
  } catch (err) {
    console.error("[orders pdf] render failed:", err);
    return NextResponse.json(
      { error: "Could not render the PDF. Check server Chrome setup." },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(order as { orderNumber: string }).orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
