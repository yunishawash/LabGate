import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, oid, readJson } from "@/lib/apiHelpers";
import SalesOrder from "@/models/SalesOrder";

/**
 * TEST-ONLY: move an order to a stage without walking the chain.
 *
 * Exists so the visibility matrix can be exercised before the transition API
 * lands. Refuses to run outside development — it writes `currentStageIndex`
 * directly, which is the one field the whole visibility model depends on being
 * monotonic and earned.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;

  const body = await readJson(req);
  const id = oid(body?.id);
  const stage = Number(body?.stage);
  if (!id || !Number.isInteger(stage) || stage < 1 || stage > 8) return badRequest("id and stage 1..8 required");

  const order = await SalesOrder.findById(id);
  if (!order) return badRequest("Unknown order");

  order.currentStageIndex = stage;
  order.currentStageEnteredAt = new Date();
  for (const step of order.steps) {
    step.status = step.stageIndex < stage ? (step.stageIndex === 1 ? "completed" : "approved") : "pending";
    step.enteredAt = step.stageIndex <= stage ? new Date() : null;
  }
  await order.save();

  return NextResponse.json({ ok: true, currentStageIndex: order.currentStageIndex });
}
