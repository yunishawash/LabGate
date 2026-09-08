import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, conflict } from "@/lib/apiHelpers";
import { notifyPosted } from "@/lib/salesNotify";
import { visibilityFilter, andFilters, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, claimAndAdvance } from "@/lib/salesTransition";
import SalesOrder from "@/models/SalesOrder";

/**
 * Net weight only — no truck, driver, gross or tare, by the client's decision.
 * The weight and the posting land in ONE write, so an order can never end up
 * weighed but unposted.
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
  const actualNetWeightKg = Number(body?.actualNetWeightKg);
  if (!Number.isFinite(actualNetWeightKg) || actualNetWeightKg <= 0) {
    return badRequest("A positive net weight is required");
  }

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & { createdById: unknown; totalWeightKg: number };
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
      note: str(body?.note, 500),
      extraSet: {
        actualNetWeightKg,
        varianceKg,
        variancePct,
        weighNote: str(body?.note, 500),
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
