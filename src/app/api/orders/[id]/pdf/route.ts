import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import AuditLog from "@/models/AuditLog";
import LabSample from "@/models/LabSample";
import User from "@/models/User";
import { buildOrderFormHtml } from "@/lib/pdf/orderFormTemplate";
import { htmlToPdf } from "@/lib/pdf/browser";

type Params = { params: Promise<{ id: string }> };

interface RawStep {
  actedById?: unknown;
  actedByName?: string;
  actedAs?: string;
  actedForRole?: string;
  actedForName?: string;
  [key: string]: unknown;
}

/**
 * Every name on this form gets its Arabic form when one exists. This form has
 * no language toggle — unlike the bilingual on-screen chain, which keeps
 * `actedByName`/`actedForName` in whatever locale-neutral form the signer's
 * account uses — so the substitution happens here, at print time, rather
 * than in the shared step data every other screen also reads.
 */
async function arabicizeSteps(steps: RawStep[]): Promise<RawStep[]> {
  const actorIds = Array.from(new Set(steps.map((s) => s.actedById).filter(Boolean).map(String)));
  const forRoles = Array.from(
    new Set(
      steps
        .filter((s) => s.actedAs && s.actedAs !== "primary" && s.actedForRole)
        .map((s) => s.actedForRole as string)
    )
  );

  const [actors, standIns] = await Promise.all([
    actorIds.length
      ? (User.find({ _id: { $in: actorIds } }).select("nameAr").lean() as Promise<
          { _id: unknown; nameAr?: string }[]
        >)
      : Promise.resolve([]),
    forRoles.length
      ? (User.find({ role: { $in: forRoles }, isActive: true }).select("role nameAr").lean() as Promise<
          { role: string; nameAr?: string }[]
        >)
      : Promise.resolve([]),
  ]);

  const actorNameArById = new Map(
    actors.filter((u) => u.nameAr).map((u) => [String(u._id), u.nameAr as string])
  );
  const standInNameArByRole = new Map<string, string>();
  for (const role of forRoles) {
    const names = standIns.filter((u) => u.role === role && u.nameAr).map((u) => u.nameAr as string);
    if (names.length) standInNameArByRole.set(role, names.join("، "));
  }

  return steps.map((s) => ({
    ...s,
    actedByName: (s.actedById ? actorNameArById.get(String(s.actedById)) : undefined) || s.actedByName,
    actedForName: (s.actedForRole ? standInNameArByRole.get(s.actedForRole) : undefined) || s.actedForName,
  }));
}

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

  // Full sample docs (readings, notes, sign-off) — the summary the detail
  // route returns for the "Lab" tab is deliberately trimmed, but the printed
  // form needs the same data the per-sample "view readings" dialog shows.
  const labSampleIds = (order as { labSampleIds?: unknown[] }).labSampleIds || [];
  const labSamples = labSampleIds.length
    ? await LabSample.find({ _id: { $in: labSampleIds } })
        .sort({ sampleDate: 1 })
        .lean()
    : [];

  const steps = ((order as { steps?: RawStep[] }).steps || []) as RawStep[];
  const orderForPdf = { ...order, steps: await arabicizeSteps(steps) };

  const html = buildOrderFormHtml(orderForPdf as never, history as never, labSamples as never);

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
