import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import {
  badRequest, badStrictStr, conflict, notFound, oid, readJson, str, strictStr,
  normalizeName, isDuplicateKeyError,
} from "@/lib/apiHelpers";
import LabCustomer from "@/models/LabCustomer";
import LabSample from "@/models/LabSample";
import mongoose from "mongoose";

type Params = { params: Promise<{ id: string }> };

import SalesOrder from "@/models/SalesOrder";
import { visibilityFilter, andFilters, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import { requireSession } from "@/lib/requireSession";

/**
 * One customer, with both halves of what we know about them: the commercial
 * side (orders and tonnage) and the quality side (samples and in-spec rate).
 *
 * This screen is only possible because orders and lab samples key on the SAME
 * customer row — the single reason the spec refused to create a second customer
 * collection.
 *
 * The order figures pass through `visibilityFilter`, so a finance manager's view
 * of a customer counts only the orders he is allowed to know about.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const customer = await LabCustomer.findOne({ _id: id, isActive: true }).lean();
  if (!customer) return notFound("Customer not found");

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);
  const canSeeOrders =
    userDoc.role === "admin" || (userDoc.permissions ?? []).includes("orders");

  const [orderStats, sampleStats, recentOrders, recentSamples] = await Promise.all([
    canSeeOrders
      ? SalesOrder.aggregate([
          { $match: andFilters(visibilityFilter(actor, delegated), { customerId: new mongoose.Types.ObjectId(id) }) },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              orderedKg: { $sum: "$totalWeightKg" },
              actualKg: { $sum: { $ifNull: ["$actualNetWeightKg", 0] } },
            },
          },
        ])
      : Promise.resolve([]),
    LabSample.aggregate([
      { $match: { isActive: true, customerId: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$overallStatus",
          count: { $sum: 1 },
          last: { $max: "$sampleDate" },
        },
      },
    ]),
    canSeeOrders
      ? SalesOrder.find(andFilters(visibilityFilter(actor, delegated), { customerId: id }))
          .sort({ orderDate: -1 }).limit(10)
          .select("orderNumber referenceNo orderDate status currentStageIndex totalWeightKg actualNetWeightKg varianceKg")
          .lean()
      : Promise.resolve([]),
    LabSample.find({ isActive: true, customerId: id })
      .sort({ sampleDate: -1 }).limit(10)
      .select("sampleNumber sampleDate product overallStatus orderNumber")
      .lean(),
  ]);

  const byStatus = Object.fromEntries(orderStats.map((r) => [r._id, r]));
  const sampleByStatus = Object.fromEntries(sampleStats.map((r) => [r._id, r]));
  const samplesTotal = sampleStats.reduce((n, r) => n + r.count, 0);
  const inSpec = (sampleByStatus.pass?.count ?? 0) + (sampleByStatus.warning?.count ?? 0);

  return NextResponse.json({
    customer,
    commercial: canSeeOrders
      ? {
          orders: orderStats.reduce((n, r) => n + r.count, 0),
          posted: byStatus.Posted?.count ?? 0,
          rejected: byStatus.Rejected?.count ?? 0,
          pending: byStatus.Pending?.count ?? 0,
          orderedKg: orderStats.reduce((n, r) => n + (r.orderedKg ?? 0), 0),
          postedKg: byStatus.Posted?.orderedKg ?? 0,
          actualKg: byStatus.Posted?.actualKg ?? 0,
          lostToRejectionKg: byStatus.Rejected?.orderedKg ?? 0,
        }
      : null,
    quality: {
      samples: samplesTotal,
      pass: sampleByStatus.pass?.count ?? 0,
      warning: sampleByStatus.warning?.count ?? 0,
      fail: sampleByStatus.fail?.count ?? 0,
      // Warnings count as in spec — inside the accepted range, just near a limit.
      inSpecPct: samplesTotal ? Math.round((inSpec / samplesTotal) * 1000) / 10 : null,
      lastSampleDate: sampleStats.reduce<Date | null>(
        (d, r) => (r.last && (!d || r.last > d) ? r.last : d), null
      ),
    },
    recentOrders,
    recentSamples,
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  // Same pair as POST /api/customers — see that route's header for why the
  // GM was added alongside the sales manager.
  const check = await requireRole("sales_manager", "general_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const update: Record<string, unknown> = {};

  /**
   * Restoring an archived customer.
   *
   * The unique index on `nameKey` is PARTIAL — it applies to active rows only,
   * which is what lets an archived name be reused. So a restore can collide
   * with a name created since, and that must be caught here rather than
   * surfacing as a duplicate-key error with no explanation.
   */
  const reactivating = body.isActive === true;
  if ("isActive" in body) update.isActive = body.isActive !== false;

  if (reactivating) {
    const archived = await LabCustomer.findById(id).select("nameKey name").lean() as
      | { nameKey: string; name: string } | null;
    if (!archived) return notFound("Customer not found");
    const clash = await LabCustomer.findOne({
      _id: { $ne: id }, nameKey: archived.nameKey, isActive: true,
    }).lean();
    if (clash) {
      return conflict(
        `"${(clash as { name: string }).name}" is already active under that name. Rename one of them first.`
      );
    }
  }

  if ("name" in body) {
    const name = str(body.name, 200);
    if (!name) return badRequest("A customer name is required");

    const nameKey = normalizeName(name);
    const clash = await LabCustomer.findOne({ _id: { $ne: id }, nameKey, isActive: true }).lean();
    if (clash) return conflict(`"${(clash as { name: string }).name}" already exists`);

    update.name = name;
    update.nameKey = nameKey;
  }
  for (const [field, max] of [
    ["nameAr", 200], ["code", 40], ["phone", 40], ["contactName", 120],
  ] as const) {
    if (field in body) update[field] = str(body[field], max);
  }
  // Longer free-text fields: rejected if too long, not silently truncated.
  for (const [field, max, label] of [
    ["address", 500, "Address"], ["notes", 4000, "Notes"],
  ] as const) {
    if (field in body) {
      const r = strictStr(body[field], max, label);
      if (!r.ok) return badStrictStr(r);
      update[field] = r.value;
    }
  }

  let updated;
  try {
    updated = await LabCustomer.findOneAndUpdate(
      // A restore has to reach the archived row; every other edit is scoped to
      // active ones so an archived customer cannot be changed by accident.
      reactivating ? { _id: id } : { _id: id, isActive: true },
      { $set: update },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict("Another customer already uses that name");
    throw err;
  }
  if (!updated) return notFound("Customer not found");

  // Keep the denormalized name on existing samples in step with the record —
  // otherwise a rename splits the customer's own history in the reports.
  if (update.name) {
    await LabSample.updateMany({ customerId: id }, { $set: { customer: update.name } });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("sales_manager", "general_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const updated = await LabCustomer.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();
  if (!updated) return notFound("Customer not found");

  return NextResponse.json({ success: true });
}
