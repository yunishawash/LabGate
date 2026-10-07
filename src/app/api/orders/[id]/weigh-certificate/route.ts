import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import { buildWeighCertificateHtml, type WeighCertificateData } from "@/lib/pdf/weighCertificateTemplate";
import { htmlToPdf } from "@/lib/pdf/browser";

type Params = { params: Promise<{ id: string }> };

/** The weighbridge certificate (شهادة توزين) — only exists once the load has been weighed and posted. */
export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const data = order as unknown as WeighCertificateData & { status: string };
  if (data.status !== "Posted") {
    return NextResponse.json(
      { error: "The weighbridge certificate is available once the order is weighed and posted." },
      { status: 409 }
    );
  }

  const html = buildWeighCertificateHtml(data);

  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html);
  } catch (err) {
    console.error("[weigh certificate] render failed:", err);
    return NextResponse.json(
      { error: "Could not render the certificate. Check server Chrome setup." },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="weigh-${data.orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
