import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule, requireRole } from "@/lib/requireSession";
import { badRequest, badStrictStr, notFound, oid, readJson, str, strictStr } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, canEdit, type Actor, type OrderLike } from "@/lib/salesWorkflow";
import { buildOrderLines } from "@/lib/salesOrderLines";
import { liveDelegationRoles, orderPermissions } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import LabCustomer from "@/models/LabCustomer";
import LabSample from "@/models/LabSample";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  /**
   * Visibility goes INSIDE the query, not into an `if` after fetching. An order
   * this actor may not see must return the same 404 as one that does not exist
   * — otherwise the response leaks that it exists.
   */
  const order = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!order) return notFound("Order not found");

  const like = order as unknown as OrderLike & { createdById: unknown };
  const permissions = await orderPermissions(
    {
      status: like.status,
      currentStageIndex: like.currentStageIndex,
      createdById: String(like.createdById),
      steps: like.steps,
    },
    actor,
    delegated
  );

  /**
   * The Lines tab needs to know, per product, whether it has been tested yet
   * — `labSampleIds` alone is just a bag of ids. Fetched here rather than
   * `$lookup`-ed in every list query, since only the detail page renders
   * per-line lab status.
   */
  const sampleIds = (order as { labSampleIds?: unknown[] }).labSampleIds ?? [];
  const labSamples = sampleIds.length
    ? await LabSample.find({ _id: { $in: sampleIds } })
        .select("_id sampleNumber productId product overallStatus sampleDate testedByName")
        .lean()
    : [];

  return NextResponse.json({ ...order, permissions, labSamples });
}

/**
 * Edit — only while nobody has approved yet (currentStageIndex === 2), and only
 * by the creator or an admin. Anything looser lets a coordinator change
 * quantities AFTER finance signed off, which silently invalidates the approval
 * chain: the exact thing this system exists to prevent.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const existing = await SalesOrder.findOne(
    andFilters(visibilityFilter(actor, delegated), { _id: id })
  ).lean();
  if (!existing) return notFound("Order not found");

  const like = existing as unknown as OrderLike & { createdById: unknown };
  const editable = canEdit(
    {
      status: like.status,
      currentStageIndex: like.currentStageIndex,
      createdById: String(like.createdById),
      steps: like.steps,
    },
    actor
  );
  if (!editable) {
    return NextResponse.json(
      { error: "This order can no longer be changed — it has already been approved." },
      { status: 409 }
    );
  }

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const update: Record<string, unknown> = {};

  if ("customerId" in body) {
    const customerId = oid(body.customerId);
    if (!customerId) return badRequest("Invalid customerId");
    const customer = (await LabCustomer.findOne({ _id: customerId, isActive: true })
      .select("name nameAr salesRepName").lean()) as { name?: string; nameAr?: string; salesRepName?: string } | null;
    if (!customer) return badRequest("Unknown customer");
    update.customerId = customerId;
    update.customer = customer.name || "";
    update.customerAr = customer.nameAr || "";
    update.salesRepName = customer.salesRepName || "";
  }

  if ("orderDate" in body) {
    const d = new Date(str(body.orderDate, 40));
    if (Number.isNaN(d.getTime())) return badRequest("Invalid orderDate");
    update.orderDate = d;
  }
  if ("deliveryDate" in body) {
    if (!body.deliveryDate) update.deliveryDate = null;
    else {
      const d = new Date(str(body.deliveryDate, 40));
      if (Number.isNaN(d.getTime())) return badRequest("Invalid deliveryDate");
      update.deliveryDate = d;
    }
  }
  if ("referenceNo" in body) update.referenceNo = str(body.referenceNo, 60);
  if ("notes" in body) {
    const notesCheck = strictStr(body.notes, 5000, "Notes");
    if (!notesCheck.ok) return badStrictStr(notesCheck);
    update.notes = notesCheck.value;
  }
  if ("customerAddress" in body) {
    const addressCheck = strictStr(body.customerAddress, 500, "Customer address");
    if (!addressCheck.ok) return badStrictStr(addressCheck);
    update.customerAddress = addressCheck.value;
  }
  if ("agentName" in body) {
    const agentCheck = strictStr(body.agentName, 120, "Agent name");
    if (!agentCheck.ok) return badStrictStr(agentCheck);
    update.agentName = agentCheck.value;
  }
  if ("paymentMethod" in body) {
    update.paymentMethod =
      body.paymentMethod === "cash" || body.paymentMethod === "deferred" ? body.paymentMethod : "";
  }

  /**
   * Changing the lines can change whether the order needs the lab at all — a
   * coordinator swapping flour for bran at stage 2 turns a nine-step route
   * into an eight-step one. So `labRequired` and the stage-6 step have to be
   * rewritten together with the lines, not left behind pointing at the old
   * product mix.
   *
   * Safe to rewrite that step unconditionally: `canEdit` already capped
   * editing at stage 2, four stages before anyone can touch the lab slot, so
   * there is no signature here to overwrite.
   */
  let labRequired: boolean | null = null;
  if (body.lines !== undefined) {
    const built = await buildOrderLines(body.lines);
    if (!built.ok) return built.error;

    update.lines = built.value.lines;
    update.labRequired = built.value.labRequired;
    update.totalBags = built.value.totalBags;
    update.totalWeightKg = built.value.totalWeightKg;
    update.totalBonusBags = built.value.totalBonusBags;
    update.totalBonusWeightKg = built.value.totalBonusWeightKg;
    labRequired = built.value.labRequired;
  }

  // Re-assert the precondition in the write itself: between the read above and
  // this update, someone may have approved.
  const updated = await SalesOrder.findOneAndUpdate(
    { _id: id, isActive: true, status: "Pending", currentStageIndex: 2 },
    {
      $set: {
        ...update,
        // Keyed on `kind`, not on the index or the key, so a future reshuffle
        // of the stage table moves this with it.
        ...(labRequired === null
          ? {}
          : { "steps.$[lab].status": labRequired ? "pending" : "skipped" }),
      },
    },
    {
      new: true,
      ...(labRequired === null ? {} : { arrayFilters: [{ "lab.kind": "data_entry" }] }),
    }
  ).lean();

  if (!updated) {
    return NextResponse.json(
      { error: "This order has already moved on — reload to see where it is." },
      { status: 409 }
    );
  }

  return NextResponse.json(updated);
}

/** Soft delete. Admin only — a live order in an approval chain is not something
 *  a participant should be able to make disappear. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await SalesOrder.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();
  if (!updated) return notFound("Order not found");

  return NextResponse.json({ success: true });
}
