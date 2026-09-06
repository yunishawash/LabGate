import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession, isUserAbsent } from "@/lib/requireSession";

/**
 * Who am I, according to the server? Used by the UI to render authority-driven
 * controls, and by the build's own smoke tests. Deliberately the plainest
 * possible example of the guard idiom.
 */
export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { userDoc } = check;
  return NextResponse.json({
    id: String(userDoc._id),
    name: userDoc.name,
    email: userDoc.email,
    role: userDoc.role,
    permissions: userDoc.permissions ?? [],
    isAbsent: isUserAbsent(userDoc),
  });
}
