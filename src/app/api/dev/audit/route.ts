import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { paging } from "@/lib/apiHelpers";
import AuditLog from "@/models/AuditLog";

/**
 * TEST-ONLY reader for the audit trail, so the build scripts can assert that a
 * change was actually recorded. The real, filterable page arrives in step 11.2.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;

  const { limit } = paging(new URL(req.url).searchParams, 20, 100);
  const entries = await AuditLog.find({}).sort({ timestamp: -1 }).limit(limit).lean();
  return NextResponse.json({ entries });
}
