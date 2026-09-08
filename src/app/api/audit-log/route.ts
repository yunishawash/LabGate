import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { containsRegex, dateRange, oneOf, paging } from "@/lib/apiHelpers";
import AuditLog from "@/models/AuditLog";

const ENTITY_TYPES = ["sales_order", "delegation", "user", "lab_sample"] as const;

/**
 * The audit trail — admin and the General Manager.
 *
 * Deliberately NOT filtered by `visibilityFilter`: the trail exists to be read
 * by someone who is allowed to see everything, and a partially-visible audit log
 * is worse than none — it looks complete while hiding exactly the entries an
 * investigation would want.
 *
 * The GM was always MEANT to have this: `seed-sales.ts` grants
 * `permissions: [..., "audit-log"]` from the project's first phase, which is
 * what puts "Audit Trail" in his sidebar and lets the page open at all. This
 * route disagreed with that on its own, admin-only — the page loaded, the
 * fetch 403'd, and the list rendered empty with nothing to say why. Widened to
 * match what the seed already granted, not a new decision.
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireRole("admin", "general_manager");
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const entityType = searchParams.get("entityType");
  if (entityType && entityType !== "all") {
    filter.entityType = oneOf(entityType, ENTITY_TYPES, "sales_order");
  }
  const action = searchParams.get("action");
  if (action && action !== "all") filter.action = action;

  const search = searchParams.get("search");
  if (search) {
    const rx = containsRegex(search);
    filter.$or = [{ entityLabel: rx }, { performedByName: rx }, { notes: rx }];
  }

  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  if (range) filter.timestamp = range;

  const { page, limit, skip } = paging(searchParams, 50);
  const [entries, total, actions] = await Promise.all([
    AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
    // The action list is derived from what is actually in the log, so a new
    // action type appears in the filter without anyone editing a dropdown.
    AuditLog.distinct("action", entityType && entityType !== "all" ? { entityType } : {}),
  ]);

  return NextResponse.json({ entries, total, page, limit, actions: (actions as string[]).sort() });
}
