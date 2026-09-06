import { NextResponse } from "next/server";
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
  });
}
