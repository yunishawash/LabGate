import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr, conflict } from "@/lib/apiHelpers";
import { notifyPosted } from "@/lib/salesNotify";
import { visibilityFilter, andFilters, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, claimAndAdvance } from "@/lib/salesTransition";
import SalesOrder from "@/models/SalesOrder";
import { VARIANCE_TOLERANCE_PCT } from "@/types";

/** Same ceiling the order's own bulk line uses: a real truck is ~30 t, so this
 *  only catches a figure typed in the wrong unit. */
const MAX_LINE_TONS = 200;

interface WeighLine {
  productId: unknown;
  product: string;
  productAr: string;
  bagWeightKg: number;
  bagCount: number;
  lineWeightKg: number;
  note?: string;
  bonusBags?: number;
  actualWeightKg?: number | null;
}

/**
 * Net weight only — no truck, driver, gross or tare, by the client's decision.
 * But one number PER LINE, not one for the whole order: each product is its
 * own scale reading, and a mixed truck cannot be reduced to a single figure
 * without losing exactly the breakdown the weighbridge exists to record.
 *
 * The weights and the posting still land in ONE write, so an order can never
 * end up weighed but unposted.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & {
    createdById: unknown;
    totalWeightKg: number;
    lines: WeighLine[];
  };

  // One weight per existing line, in the SAME order `order.lines` is stored —
  // lines carry no id of their own and editing is locked long before stage 8,
  // so position is a stable, safe key here.
  const inputLines = body?.lines;
  if (!Array.isArray(inputLines) || inputLines.length !== like.lines.length) {
    return badRequest("A weight for every line is required");
  }

  /**
   * Sent in TONNES — the unit the weighbridge ticket and the mill both talk
   * in — and stored in kilograms, which every other weight in this system is
   * stored in and which the variance maths, the reports and the exports all
   * depend on. Converted here, at the edge, exactly once; three decimals of a
   * tonne is one kilogram, so nothing is lost on the way in.
   */
  const tons = inputLines.map((v) => Number(v));
  if (tons.some((w) => !Number.isFinite(w) || w <= 0)) {
    return badRequest("Every line needs a positive net weight in tonnes");
  }
  if (tons.some((w) => w > MAX_LINE_TONS)) {
    return badRequest(`A line cannot weigh more than ${MAX_LINE_TONS} t — check the figure`);
  }
  const weights = tons.map((w) => Math.round(w * 1000 * 1000) / 1000);

  // One textarea, but the value is written into two schema locations — the
  // step's own note and the order-level `weighNote` — so it is validated
  // once here and reused, not re-checked against two different caps.
  const noteCheck = strictStr(body?.note, 2000, "Note");
  if (!noteCheck.ok) return badStrictStr(noteCheck);

  const varianceReasonCheck = strictStr(body?.varianceReason, 2000, "Variance reason");
  if (!varianceReasonCheck.ok) return badStrictStr(varianceReasonCheck);

  /**
   * The load itself: where it is going, what is carrying it, and what the
   * scale read before and after. These were ruled lines on a printed sheet
   * until now, so the system held a net weight with nothing to attribute it
   * to.
   *
   * All four are required. The certificate is handed to the driver at the
   * gate, and a blank vehicle or carrier on it is the field being there
   * without being used — which is the state this replaces.
   */
  const loadFields: [key: string, label: string, max: number][] = [
    ["weighDestination", "Destination", 200],
    ["weighVehicleNo", "Vehicle number", 60],
    ["weighCarrier", "Carrier", 160],
    ["weighDriver", "Driver", 160],
  ];
  const load: Record<string, string> = {};
  for (const [key, label, max] of loadFields) {
    const check = strictStr(body?.[key], max, label);
    if (!check.ok) return badStrictStr(check);
    if (!check.value) return badRequest(`${label} is required to weigh this load`);
    load[key] = check.value;
  }

  /**
   * Gross and tare, in tonnes like every other weight entered here.
   *
   * Kept ALONGSIDE the per-line nets rather than replacing them: the scale
   * sees one truck, the order needs a figure per product. The two are
   * expected to agree, and keeping both is what makes a disagreement
   * visible — deriving one from the other would hide it.
   */
  const grossTons = Number(body?.grossTons);
  const tareTons = Number(body?.tareTons);
  if (!Number.isFinite(grossTons) || grossTons <= 0) {
    return badRequest("The gross weight (tonnes) is required");
  }
  if (!Number.isFinite(tareTons) || tareTons <= 0) {
    return badRequest("The tare weight (tonnes) is required");
  }
  if (tareTons >= grossTons) {
    return badRequest("The tare weight must be less than the gross weight");
  }
  if (grossTons > MAX_LINE_TONS) {
    return badRequest(`The gross weight cannot exceed ${MAX_LINE_TONS} t — check the figure`);
  }
  const grossWeightKg = Math.round(grossTons * 1000 * 1000) / 1000;
  const tareWeightKg = Math.round(tareTons * 1000 * 1000) / 1000;

  const shaped: OrderLike = {
    status: like.status,
    currentStageIndex: like.currentStageIndex,
    createdById: String(like.createdById),
    steps: like.steps,
  };

  const slot = await resolveSlot(shaped, actor, "weigh");
  if ("code" in slot) {
    if (slot.code === "terminal") return conflict("This order is closed.");
    return NextResponse.json({ error: "This order is not ready for weighing." }, { status: 403 });
  }

  const weighedLines = like.lines.map((l, i) => ({ ...l, actualWeightKg: weights[i] }));
  const actualNetWeightKg = Math.round(weights.reduce((s, w) => s + w, 0) * 1000) / 1000;

  const ordered = like.totalWeightKg || 0;
  const varianceKg = Math.round((actualNetWeightKg - ordered) * 1000) / 1000;
  const variancePct = ordered ? Math.round((varianceKg / ordered) * 10000) / 100 : null;

  /**
   * Past the tolerance, the gap has to be explained before it can be posted.
   *
   * Checked AFTER the weights are computed, from the server's own figures —
   * never from a flag the client sends about whether an explanation was
   * needed. The dialog shows the same field at the same threshold, but the
   * dialog is where the operator is helped, not where the rule lives.
   *
   * Only the ordered weight can make this unanswerable: an order totalling
   * zero has no percentage to compare against, so `variancePct` is null and
   * nothing is demanded.
   */
  if (variancePct !== null && Math.abs(variancePct) > VARIANCE_TOLERANCE_PCT && !varianceReasonCheck.value) {
    return badRequest(
      `The weight differs from the order by ${variancePct > 0 ? "+" : ""}${variancePct}% ` +
        `(beyond ±${VARIANCE_TOLERANCE_PCT}%). State the reason for the difference before posting.`
    );
  }

  const result = await claimAndAdvance(
    id,
    slot.stage,
    { _id: userDoc._id, name: userDoc.name },
    {
      actedAs: slot.actedAs,
      actedForRole: slot.actedForRole,
      actedForName: slot.actedForName,
      note: noteCheck.value,
      extraSet: {
        lines: weighedLines,
        actualNetWeightKg,
        varianceKg,
        variancePct,
        weighNote: noteCheck.value,
        varianceReason: varianceReasonCheck.value,
        ...load,
        grossWeightKg,
        tareWeightKg,
        weighedById: userDoc._id,
        weighedByName: userDoc.name,
      },
    }
  );

  if ("code" in result) {
    return conflict("This order has already moved on — reload to see where it is.");
  }

  /**
   * Fan-out is fire-and-forget on purpose. The transition already committed;
   * making the caller wait on a mailing list — or fail because of one — would
   * put a notification ahead of an approval in importance.
   */
  notifyPosted(
    result.order as unknown as Parameters<typeof notifyPosted>[0],
    userDoc._id
  ).catch((e) => console.error("[weigh] notifyPosted:", e));

  return NextResponse.json({
    order: result.order,
    posted: result.posted,
    ordered,
    actualNetWeightKg,
    varianceKg,
    variancePct,
    varianceReason: varianceReasonCheck.value,
  });
}
