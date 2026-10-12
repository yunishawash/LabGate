import SalesOrder from "@/models/SalesOrder";
import { LATE_MS } from "@/lib/aging";
import { stagesAt, type OrderLike } from "@/lib/salesWorkflow";
import { rejectOrder } from "@/lib/salesTransition";
import { notifyRejected } from "@/lib/salesNotify";

/**
 * The system's own words, not an admin's (client request, 2026-10-12) — an
 * order dying of neglect is not anyone's personal decision, so it must not
 * read as one. Arabic only, like every other `rejection.reason`/`reasonLabel`
 * in this codebase: that field is read by Arabic-speaking managers on the
 * order page, the certificate, the report and the printed form.
 */
export const AUTO_REJECT_REASON_AR =
  "تم رفض هذه الطلبية وإغلاقها تلقائيًا من قِبل النظام، بسبب توقّفها أكثر من 48 ساعة دون اتخاذ أي إجراء.";

export interface AutoRejectCandidate {
  _id: string;
  orderNumber: string;
  customer: string;
  customerAr: string;
  stageRole: string;
  hoursStuck: number;
}

export interface AutoRejectResult {
  candidates: AutoRejectCandidate[];
  /** How many were actually rejected — 0 on a dry run, and possibly lower
   *  than candidates.length on a real run if one moved on between the scan
   *  and the write (`rejectOrder`'s own atomic guard catches that race). */
  rejectedCount: number;
}

/**
 * Finds every order that has sat PENDING at its current stage past
 * `LATE_HOURS` (the same 48h the dashboard already warns about in amber/red —
 * see `src/lib/aging.ts`) and, unless `dryRun`, rejects and closes each one
 * under the SYSTEM's own authority rather than a person's: `rejection.byId`
 * is null, `rejection.byName` is "النظام", and the reason is the fixed text
 * above, never a free-typed one.
 *
 * Meant to be run periodically (see `src/scripts/auto-reject-stuck-orders.ts`
 * and the crontab line documented in DEPLOY_PM2.md) — idempotent by
 * construction, since a re-run only ever matches orders still `Pending`.
 */
export async function autoRejectStuckOrders(
  opts: { dryRun: boolean }
): Promise<AutoRejectResult> {
  const cutoff = new Date(Date.now() - LATE_MS);
  const now = Date.now();

  const stuck = await SalesOrder.find({
    isActive: true,
    status: "Pending",
    currentStageEnteredAt: { $lte: cutoff },
  })
    .select("orderNumber customer customerAr currentStageIndex currentStageEnteredAt steps createdById")
    .lean();

  const candidates: AutoRejectCandidate[] = stuck.map((o) => ({
    _id: String(o._id),
    orderNumber: o.orderNumber,
    customer: o.customer,
    customerAr: o.customerAr,
    stageRole: stagesAt(o.currentStageIndex)[0]?.role ?? "",
    hoursStuck: Math.floor((now - new Date(o.currentStageEnteredAt).getTime()) / 3_600_000),
  }));

  if (opts.dryRun) return { candidates, rejectedCount: 0 };

  let rejectedCount = 0;
  for (const o of stuck) {
    const like: OrderLike = {
      status: "Pending",
      currentStageIndex: o.currentStageIndex,
      createdById: String(o.createdById),
      steps: o.steps as OrderLike["steps"],
    };
    // The role whose stage this actually stalled at — passing it as
    // `actedForRole` is what makes `rejectOrder` mark THAT step "rejected"
    // (with this reason attached) instead of lumping it into the generic
    // "skipped" every other now-moot future step gets.
    const stageRole = stagesAt(o.currentStageIndex)[0]?.role ?? "system";

    const result = await rejectOrder(
      String(o._id), like,
      { _id: null, name: "النظام", role: "system" },
      AUTO_REJECT_REASON_AR,
      stageRole
    );

    if ("code" in result) continue; // raced — moved on since the scan; leave it
    rejectedCount++;
    notifyRejected(result as never, null).catch((e) =>
      console.error("[autoRejectStuckOrders] notifyRejected:", e)
    );
  }

  return { candidates, rejectedCount };
}
