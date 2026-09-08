import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson } from "@/lib/apiHelpers";
import Notification from "@/models/Notification";

type Params = { params: Promise<{ id: string }> };

/**
 * Mark one read (or unread). The `userId` is part of the FILTER, never checked
 * after the fetch: a notification belonging to someone else must be
 * indistinguishable from one that does not exist.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  const isRead = body?.isRead === false ? false : true;

  const updated = await Notification.findOneAndUpdate(
    { _id: id, userId: userDoc._id },
    { $set: { isRead } },
    { new: true }
  ).lean();
  if (!updated) return notFound("Notification not found");

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const gone = await Notification.findOneAndDelete({ _id: id, userId: userDoc._id }).lean();
  if (!gone) return notFound("Notification not found");

  return NextResponse.json({ deleted: true });
}
