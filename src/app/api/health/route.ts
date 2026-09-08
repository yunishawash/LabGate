import { NextResponse } from "next/server";
import { notAbsentFilter } from "@/lib/requireSession";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { LATE_HOURS, LATE_MS, WARN_HOURS } from "@/lib/aging";
import SalesOrder from "@/models/SalesOrder";
import LabSample from "@/models/LabSample";
import User from "@/models/User";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import { requireModule } from "@/lib/requireSession";

/** Admin-only system health — backs dashboard block K (SPEC §10.0). */
export async function GET() {
  await connectDB();
  const check = await requireModule("health");
  if (check.error) return check.error;

  const started = Date.now();
  let dbOk = false;
  try {
    await mongoose.connection.db!.admin().ping();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const hello = dbOk ? await mongoose.connection.db!.admin().command({ hello: 1 }) : null;

  /**
   * Which chain roles have nobody active behind them.
   *
   * This is the operational fact that matters most and shows up nowhere else:
   * an unstaffed role does not throw, does not log, and does not alert until an
   * order reaches that stage — at which point it parks there silently. Better
   * to see it on a health page on a quiet Tuesday than to discover it from a
   * customer.
   */
  const chainRoles = Array.from(new Set(SALES_STAGES.map((s) => s.role)));
  const now = new Date();
  const staffing = dbOk
    ? await Promise.all(
        chainRoles.map(async (role) => {
          const [active, present] = await Promise.all([
            User.countDocuments({ role, isActive: true }),
            User.countDocuments({ role, isActive: true, ...notAbsentFilter(now) }),
          ]);
          const stages = SALES_STAGES.filter((s) => s.role === role);
          return {
            role,
            active,
            present,
            stages: stages.map((s) => s.index),
            hasDeputy: stages.some((s) => !!s.deputyRole),
          };
        })
      )
    : [];

  const [orders, pending, stuck, samples, users] = dbOk
    ? await Promise.all([
        SalesOrder.countDocuments({ isActive: true }),
        SalesOrder.countDocuments({ isActive: true, status: "Pending" }),
        SalesOrder.countDocuments({
          isActive: true,
          status: "Pending",
          currentStageEnteredAt: { $lt: new Date(now.getTime() - LATE_MS) },
        }),
        LabSample.countDocuments({ isActive: true }),
        User.countDocuments({ isActive: true }),
      ])
    : [0, 0, 0, 0, 0];

  return NextResponse.json({
    db: {
      ok: dbOk,
      latencyMs: Date.now() - started,
      name: mongoose.connection.name,
      writable: hello?.isWritablePrimary === true,
      replicaSet: hello?.setName ?? null, // null = standalone, which is correct here
    },
    app: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      env: process.env.NODE_ENV,
    },
    counts: { orders, pending, stuck, samples, users },
    // Surfaced so the threshold can be READ from the running system rather than
    // inferred from a colour somebody noticed on a Tuesday.
    thresholds: { warnHours: WARN_HOURS, lateHours: LATE_HOURS },
    staffing,
  });
}
