import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import { visibilityFilter, andFilters, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import AuditLog from "@/models/AuditLog";

type Params = { params: Promise<{ id: string }> };

/**
 * The order's audit trail.
 *
 * The visibility check runs against the ORDER first, not the log: an actor who
 * may not see an order may not read its history either, and the 404 must be
 * indistinguishable from a nonexistent id.
 */
export async function GET(_req: NextRequest, { params }: Params) {
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
  ).select("_id").lean();
  if (!order) return notFound("Order not found");

  const entries = await AuditLog.find({ entityType: "sales_order", entityId: id })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean();

  return NextResponse.json({ entries });
}
