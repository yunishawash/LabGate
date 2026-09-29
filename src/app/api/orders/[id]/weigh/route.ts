import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr, conflict } from "@/lib/apiHelpers";
import { notifyPosted } from "@/lib/salesNotify";
import { visibilityFilter, andFilters, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, claimAndAdvance } from "@/lib/salesTransition";
import SalesOrder from "@/models/SalesOrder";

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
  const weights = inputLines.map((v) => Number(v));
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) {
    return badRequest("Every line needs a positive net weight");
  }

  // One textarea, but the value is written into two schema locations — the
  // step's own note and the order-level `weighNote` — so it is validated
  // once here and reused, not re-checked against two different caps.
  const noteCheck = strictStr(body?.note, 2000, "Note");
  if (!noteCheck.ok) return badStrictStr(noteCheck);

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

  const result = await claimAndAdvance(
    id,
    slot.stage,
    { _id: userDoc._id, name: userDoc.name },
    {
      actedAs: slot.actedAs,
      actedForRole: slot.actedForRole,
      note: noteCheck.value,
      extraSet: {
        lines: weighedLines,
        actualNetWeightKg,
        varianceKg,
        variancePct,
        weighNote: noteCheck.value,
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
  });
}
