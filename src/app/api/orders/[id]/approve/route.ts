import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, conflict } from "@/lib/apiHelpers";
import { notifyStageEntered, notifyPosted } from "@/lib/salesNotify";
import { visibilityFilter, andFilters, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, claimAndAdvance } from "@/lib/salesTransition";
import SalesOrder from "@/models/SalesOrder";

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

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & { createdById: unknown };
  const shaped: OrderLike = {
    status: like.status,
    currentStageIndex: like.currentStageIndex,
    createdById: String(like.createdById),
    steps: like.steps,
  };

  const slot = await resolveSlot(shaped, actor, "approval");
  if ("code" in slot) {
    if (slot.code === "terminal") return conflict("This order is closed.");
    return NextResponse.json({ error: "It is not your turn on this order." }, { status: 403 });
  }

  const body = await readJson(req);
  const result = await claimAndAdvance(
    id,
    slot.stage,
    { _id: userDoc._id, name: userDoc.name },
    { actedAs: slot.actedAs, actedForRole: slot.actedForRole, note: str(body?.note, 1000) }
  );

  if ("code" in result) {
    return conflict("This order has already moved on — reload to see where it is.");
  }

  /**
   * Fan-out is fire-and-forget on purpose. The transition already committed;
   * making the caller wait on a mailing list — or fail because of one — would
   * put a notification ahead of an approval in importance.
   */
  const moved = result.order as unknown as Parameters<typeof notifyStageEntered>[0];
  if (result.posted) {
    notifyPosted(moved, userDoc._id).catch((e) => console.error("[approve] notifyPosted:", e));
  } else if (result.advancedTo) {
    notifyStageEntered(moved, result.advancedTo, userDoc._id)
      .catch((e) => console.error("[approve] notifyStageEntered:", e));
  }

  return NextResponse.json({
    order: result.order,
    advancedTo: result.advancedTo,
    posted: result.posted,
    actedAs: result.actedAs,
    actedForRole: result.actedForRole,
    // Stage 7 completes only when both signatures are in — say so plainly
    // rather than letting the signer wonder why nothing moved.
    waitingForOther: result.advancedTo === null && !result.posted,
  });
}
