import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import {
  badRequest, conflict, isDuplicateKeyError, normalizeName, readJson, str,
} from "@/lib/apiHelpers";
import City from "@/models/City";

/** Reading the list is harmless for any signed-in user — the customer form
 *  needs it, and so does every report that groups by city. */
export async function GET() {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const cities = await City.find({ isActive: true }).sort({ name: 1 }).lean();
  return NextResponse.json({ cities });
}

/**
 * Adding a city is gated to the roles that may add a CUSTOMER, because that
 * is the only reason to add one: the field is a dropdown precisely so nobody
 * invents "نابلس " beside "نابلس" and splits a report in two.
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("sales_manager", "general_manager");
  if (check.error) return check.error;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const name = str(body.name, 120);
  if (!name) return badRequest("A city name is required");
  const nameKey = normalizeName(name);

  // Friendly check first; the partial unique index catches the race it cannot.
  const existing = (await City.findOne({ nameKey, isActive: true }).lean()) as { name: string } | null;
  if (existing) return conflict(`"${existing.name}" already exists`);

  try {
    const created = await City.create({ name, nameKey, nameAr: name, isActive: true });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${name}" already exists`);
    throw err;
  }
}
