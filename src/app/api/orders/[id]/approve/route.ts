import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, strictStr, conflict } from "@/lib/apiHelpers";
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

  // Collections must write their note before Finance Manager signs — the
  // note IS the thing being approved, so approving without it would just be
  // a blank rubber stamp.
  if (slot.stage.key === "finance_manager_approval") {
    const collectionsNote = (order as unknown as { collections?: { note?: string } }).collections?.note;
    if (!collectionsNote || !collectionsNote.trim()) {
      return badRequest(
        "The Collections department must enter their note before the Finance Manager can approve."
      );
    }
  }

  const body = await readJson(req);
  const noteCheck = strictStr(body?.note, 2000, "Note");
  if (!noteCheck.ok) return badStrictStr(noteCheck);

  /**
   * At the Technical Manager's stage the one note box IS the Packing note.
   *
   * "ملاحظات قسم التعبئة" is printed on the MS-SC/F7 form and is his to write
   * — he is the one who knows what the packing floor needs told. Routing it
   * here rather than leaving it to a separate panel means it is written in
   * the same action as the approval, so an order cannot move past his stage
   * carrying a half-saved note, and nobody has to remember a second step.
   *
   * It goes to `packing` INSTEAD of the step note, not as well: one box must
   * not write the same sentence into two fields that are printed in two
   * different places on the same sheet.
   */
  const isPackingStage = slot.stage.key === "technical_manager_approval";
  const extraSet = isPackingStage
    ? {
        "packing.note": noteCheck.value,
        "packing.byId": userDoc._id,
        "packing.byName": userDoc.name,
        "packing.at": new Date(),
      }
    : undefined;

  const result = await claimAndAdvance(
    id,
    slot.stage,
    { _id: userDoc._id, name: userDoc.name },
    {
      actedAs: slot.actedAs,
      actedForRole: slot.actedForRole,
      actedForName: slot.actedForName,
      note: isPackingStage ? "" : noteCheck.value,
      extraSet,
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
    actedForName: result.actedForName,
    // True only on a dual-slot stage where this signature wasn't the last one
    // needed — say so plainly rather than letting the signer wonder why
    // nothing moved. No stage is currently dual, so this is always false today.
    waitingForOther: result.advancedTo === null && !result.posted,
  });
}
