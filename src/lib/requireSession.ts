import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { auth } from "@/lib/auth";
import User from "@/models/User";
import { canAccessModule } from "@/lib/modules";

/**
 * Route guards for `/api`.
 *
 * `src/proxy.ts`'s matcher excludes `/api`, so there is NO ambient protection —
 * every route handler must guard itself (SPEC §3). These return a
 * `{ error } | { userDoc }` shape so they drop into one idiom:
 *
 *     const check = await requireRole("sales_coordinator");
 *     if (check.error) return check.error;
 *     const { userDoc } = check;
 *
 * They verify `isActive` against the database on every call rather than
 * trusting the JWT, so deactivating a user takes effect on their very next
 * request instead of whenever their token happens to expire.
 */

export interface SessionUser {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  isAbsent: boolean;
  absentFrom: Date | null;
  absentTo: Date | null;
}

type Guard =
  | { error: NextResponse; userDoc?: undefined }
  | { error?: undefined; userDoc: SessionUser };

const unauthorized = (): Guard => ({
  error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
});

const forbidden = (): Guard => ({
  error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
});

/** Any authenticated, ACTIVE user. Call after connectDB(). */
export async function requireSession(): Promise<Guard> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return unauthorized();

  const userDoc = (await User.findOne({ _id: id, isActive: true })
    .select("_id name email role permissions isAbsent absentFrom absentTo")
    .lean()) as SessionUser | null;

  if (!userDoc) return unauthorized();
  return { userDoc };
}

/** Authenticated AND holding one of `roles`. `admin` always passes. */
export async function requireRole(...roles: string[]): Promise<Guard> {
  const check = await requireSession();
  if (check.error) return check;

  const { userDoc } = check;
  if (userDoc.role !== "admin" && !roles.includes(userDoc.role)) return forbidden();
  return { userDoc };
}

/**
 * Authenticated AND permitted for `module`. Mirrors the rule the proxy applies
 * to pages, so an API can never be more permissive than the screen it backs.
 */
export async function requireModule(module: string): Promise<Guard> {
  const check = await requireSession();
  if (check.error) return check;

  const { userDoc } = check;
  if (!canAccessModule(userDoc.role, userDoc.permissions ?? [], module)) return forbidden();
  return { userDoc };
}

/**
 * Is this user away right now? True when the flag is set, or when today falls
 * inside an absence window. A window with no end date is open-ended.
 *
 * Absence is what unlocks a deputy's signature (SPEC §8.2), so this rule and
 * `notAbsentFilter` below live together — they must never drift apart.
 */
export function isUserAbsent(
  user: Pick<SessionUser, "isAbsent" | "absentFrom" | "absentTo">,
  now: Date = new Date()
): boolean {
  if (user.isAbsent) return true;
  if (!user.absentFrom) return false;
  if (now < new Date(user.absentFrom)) return false;
  return !user.absentTo || now <= new Date(user.absentTo);
}

/**
 * Mongo fragment matching users who are NOT away right now — the query behind
 * "is every holder of this role absent?".
 */
export function notAbsentFilter(now: Date = new Date()): Record<string, unknown> {
  return {
    isAbsent: { $ne: true },
    $or: [
      { absentFrom: null },
      { absentFrom: { $gt: now } },
      { absentTo: { $ne: null, $lt: now } },
    ],
  };
}
