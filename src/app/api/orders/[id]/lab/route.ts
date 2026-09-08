import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, conflict } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { resolveSlot, claimAndAdvance } from "@/lib/salesTransition";
import { rollUpStatus, type LabStatus } from "@/lib/labQc";
import { notifyStageEntered } from "@/lib/salesNotify";
import { writeAudit } from "@/lib/audit";
import SalesOrder from "@/models/SalesOrder";
import LabSample from "@/models/LabSample";

type Params = { params: Promise<{ id: string }> };

/**
 * Stage 6 — attach lab results and, once every distinct product on the order
 * has at least one tested sample, hand the order to the two signatories.
 *
 * An order can carry several product lines, and each product needs its own
 * sample — one flour tested does not speak for a different flour on the same
 * order. So this route ACCUMULATES `labSampleIds` across repeated calls (one
 * call per product, from the order's Lines tab) instead of overwriting them,
 * and only completes stage 6 — via `claimAndAdvance`, which is what actually
 * moves `currentStageIndex` to 7 — once every line's product is covered.
 * Until then the stage-6 step stays "pending" on purpose, so the technician
 * (or a delegate/deputy) can keep coming back for the remaining products.
 *
 * The samples are created through the ordinary lab screens, which already own
 * the scoring, the thresholds and the fail alert. This route does not re-score
 * anything: it links samples that exist, rolls their verdicts up onto the
 * order, and completes the stage when coverage is full. Duplicating
 * `scoreResults` here would mean two places deciding whether flour passes.
 *
 * The roll-up is pessimistic (`fail` beats `warning` beats `pass`), computed
 * over EVERY sample attached so far (not just this call's), so the two
 * managers always see the worst verdict across all tested products.
 */
export async function POST(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  const rawIds = Array.isArray(body?.sampleIds) ? body.sampleIds : [];
  const sampleIds = rawIds.map((x: unknown) => oid(x)).filter(Boolean);
  if (!sampleIds.length) {
    return badRequest("At least one lab sample is required to complete this stage");
  }
  if (sampleIds.length !== rawIds.length) return badRequest("Invalid sample id");
  if (sampleIds.length > 20) return badRequest("Too many samples for one order");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };

  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & {
    createdById: unknown; orderNumber: string;
    lines: { productId: unknown; product: string; productAr: string }[];
    labSampleIds: unknown[];
  };
  const shaped: OrderLike = {
    status: like.status,
    currentStageIndex: like.currentStageIndex,
    createdById: String(like.createdById),
    steps: like.steps,
  };

  const slot = await resolveSlot(shaped, actor, "data_entry");
  if ("code" in slot) {
    if (slot.code === "terminal") return conflict("This order is closed.");
    return NextResponse.json({ error: "It is not your turn on this order." }, { status: 403 });
  }

  const newSamples = await LabSample.find({ _id: { $in: sampleIds }, isActive: true })
    .select("_id overallStatus productId")
    .lean();
  if (newSamples.length !== sampleIds.length) return badRequest("One of the samples was not found");

  // Samples already linked from an earlier call for a different product on
  // this same order — needed both for the roll-up and for coverage.
  const existingIds = (like.labSampleIds ?? []).map((x) => String(x));
  const existingSamples = existingIds.length
    ? await LabSample.find({ _id: { $in: existingIds } }).select("_id overallStatus productId").lean()
    : [];

  const newIds = new Set(sampleIds.map((x) => String(x)));
  // Dedupe in case the same sample is resubmitted for a product it already covers.
  const allSamples = [
    ...existingSamples.filter((s) => !newIds.has(String((s as { _id: unknown })._id))),
    ...newSamples,
  ];
  const mergedIds = allSamples.map((s) => (s as { _id: unknown })._id);

  const labOverallStatus = rollUpStatus(
    allSamples.map((s) => (s as { overallStatus: LabStatus }).overallStatus)
  );

  /**
   * Coverage: every DISTINCT product across the order's lines must have at
   * least one attached, tested sample. Two lines of the same product share
   * one sample requirement — "كل صنف يتم فحصه" is about the product, not the
   * line — so this is keyed on productId, not on line index.
   */
  const coveredProductIds = new Set(
    allSamples.map((s) => String((s as { productId: unknown }).productId))
  );
  const previouslyCoveredCount = new Set(
    existingSamples.map((s) => String((s as { productId: unknown }).productId))
  ).size;
  const requiredProducts = new Map<string, { product: string; productAr: string }>();
  for (const l of like.lines ?? []) {
    const pid = String(l.productId);
    if (!requiredProducts.has(pid)) {
      requiredProducts.set(pid, { product: l.product, productAr: l.productAr });
    }
  }
  const remaining = Array.from(requiredProducts.entries())
    .filter(([pid]) => !coveredProductIds.has(pid))
    .map(([productId, p]) => ({ productId, ...p }));
  const complete = remaining.length === 0;

  /**
   * Link the new samples BEFORE advancing (or before returning, if this call
   * does not complete coverage). If the stage claim then loses a race the
   * links are still correct — a sample pointing at its order is true either
   * way, whereas an advanced stage with no attached results is not.
   */
  await LabSample.updateMany(
    { _id: { $in: sampleIds } },
    { $set: { orderId: id, orderNumber: like.orderNumber } }
  );
  await SalesOrder.updateOne(
    { _id: id },
    { $set: { labSampleIds: mergedIds, labOverallStatus } }
  );

  if (!complete) {
    // Coverage isn't full yet — stage 6 stays open for the remaining
    // product(s). No transition, so no `claimAndAdvance` call; record the
    // partial progress in the trail ourselves, since nothing else will.
    await writeAudit({
      entityType: "sales_order",
      entityId: id,
      entityLabel: like.orderNumber,
      action: "lab_attached",
      field: "lab_results",
      oldValue: `${previouslyCoveredCount}/${requiredProducts.size}`,
      newValue: `${coveredProductIds.size}/${requiredProducts.size}`,
      performedBy: userDoc._id,
      performedByName: userDoc.name,
      notes:
        `${newSamples.length} sample(s) linked — ${coveredProductIds.size}/${requiredProducts.size} products tested` +
        (str(body?.note, 1000) ? ` — ${str(body?.note, 1000)}` : ""),
    });

    const fresh = await SalesOrder.findById(id).lean();
    return NextResponse.json({
      order: fresh,
      advancedTo: null,
      complete: false,
      remainingProducts: remaining,
      labOverallStatus,
      attached: newSamples.length,
    });
  }

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
  if (result.advancedTo) {
    notifyStageEntered(
      result.order as unknown as Parameters<typeof notifyStageEntered>[0],
      result.advancedTo,
      userDoc._id
    ).catch((e) => console.error("[lab] notifyStageEntered:", e));
  }

  // No extra audit write here on the completing call: claimAndAdvance already
  // logs the transition, and it maps a data_entry stage to `lab_attached`. A
  // second entry from this route would put the same event in the trail twice.
  return NextResponse.json({
    order: result.order,
    advancedTo: result.advancedTo,
    complete: true,
    remainingProducts: [],
    labOverallStatus,
    attached: newSamples.length,
  });
}
