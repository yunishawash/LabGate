import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr, conflict } from "@/lib/apiHelpers";
import { notifyRejected } from "@/lib/salesNotify";
import {
  visibilityFilter, andFilters, canReject, stagesAt, type Actor, type OrderLike,
} from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { resolveSlot, rejectOrder } from "@/lib/salesTransition";
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

  const body = await readJson(req);
  const reasonCheck = strictStr(body?.reason, 2000, "Reason");
  if (!reasonCheck.ok) return badStrictStr(reasonCheck);
  const reason = reasonCheck.value;
  // A rejection without a stated reason is a dead end nobody can learn from —
  // and it is what the rejection-analysis report reads.
  if (!reason) return badRequest("A reason is required to reject an order");

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

  if (shaped.status !== "Pending") return conflict("This order is already closed.");

  // The GM and admin may kill a live order at ANY stage. Everyone else needs a
  // live approval slot of their own — including via deputy or delegation.
  let actedForRole = actor.role;
  if (!canReject(shaped, actor)) {
    const slot = await resolveSlot(shaped, actor, "approval");
    if ("code" in slot) {
      return NextResponse.json({ error: "It is not your turn on this order." }, { status: 403 });
    }
    actedForRole = slot.actedForRole;
  } else if (actor.role !== "admin") {
    const own = stagesAt(shaped.currentStageIndex).find((s) => s.role === actor.role);
    actedForRole = own ? own.role : actor.role;
  }

  const result = await rejectOrder(
    id, shaped,
    { _id: userDoc._id, name: userDoc.name, role: userDoc.role },
    reason, actedForRole
  );

  if ("code" in result) {
    return conflict("This order has already moved on — reload to see where it is.");
  }

  /**
   * Fan-out is fire-and-forget on purpose. The transition already committed;
   * making the caller wait on a mailing list — or fail because of one — would
   * put a notification ahead of an approval in importance.
   */
  notifyRejected(
    result as unknown as Parameters<typeof notifyRejected>[0],
    userDoc._id
  ).catch((e) => console.error("[reject] notifyRejected:", e));

  return NextResponse.json({ order: result, closed: true });
}
