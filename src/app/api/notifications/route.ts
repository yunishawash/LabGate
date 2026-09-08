import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { readJson, paging } from "@/lib/apiHelpers";
import Notification from "@/models/Notification";

/**
 * This user's notifications and unread count.
 *
 * Scoped to `userId` for EVERYONE, admins included. The CMMS shows admins
 * everyone's notifications, and with a fan-out on every stage of every order
 * that would bury an admin's own alerts under other people's approval queues
 * within a day (SPEC §14.6).
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { searchParams } = new URL(req.url);
  const { page, limit, skip } = paging(searchParams, 20);

  const filter: Record<string, unknown> = { userId: userDoc._id };
  if (searchParams.get("unread") === "true") filter.isRead = false;

  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: userDoc._id, isRead: false }),
  ]);

  return NextResponse.json({ notifications, total, unread, page, limit });
}

/** `{ markAllRead: true }` — the only bulk action the bell needs. */
export async function PUT(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const body = await readJson(req);
  if (body?.markAllRead !== true) {
    return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  }

  const res = await Notification.updateMany(
    { userId: userDoc._id, isRead: false },
    { $set: { isRead: true } }
  );
  return NextResponse.json({ marked: res.modifiedCount ?? 0 });
}
