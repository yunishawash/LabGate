import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, conflict, containsRegex, isDuplicateKeyError, oneOf, paging, readJson, str } from "@/lib/apiHelpers";
import { writeAudit } from "@/lib/audit";
import { USER_ROLES } from "@/types";
import { ALL_PERMISSIONS } from "@/lib/modules";
import User from "@/models/User";

/** bcrypt cost 12, hashed at every caller. There is no pre-save hook on User —
 *  the CMMS removed it after double-hashing, and this project never added one. */
const COST = 12;

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const role = searchParams.get("role");
  if (role && role !== "all") filter.role = oneOf(role, USER_ROLES, "sales_coordinator");
  if (searchParams.get("active") === "true") filter.isActive = true;

  const search = searchParams.get("search");
  if (search) {
    const rx = containsRegex(search);
    filter.$or = [{ name: rx }, { nameAr: rx }, { email: rx }];
  }

  const { page, limit, skip } = paging(searchParams, 50);
  const [users, total] = await Promise.all([
    User.find(filter).select("-password").sort({ role: 1, name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return NextResponse.json({ users, total, page, limit });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("admin");
  if (check.error) return check.error;
  const { userDoc } = check;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const password = str(body.password, 200);
  if (!name) return badRequest("A name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest("A valid email is required");
  if (password.length < 6) return badRequest("The password must be at least 6 characters");

  const role = oneOf(body.role, USER_ROLES, "sales_coordinator");
  const permissions = Array.isArray(body.permissions)
    ? (body.permissions as unknown[]).map(String).filter((p) => ALL_PERMISSIONS.includes(p))
    : [];

  try {
    const created = await User.create({
      name,
      nameAr: str(body.nameAr, 120),
      email,
      password: await bcrypt.hash(password, COST),
      role,
      permissions,
      isActive: body.isActive !== false,
    });

    /**
     * Creating a user with a chain role hands out signing power. Audited for
     * the same reason an approval is: somebody must be able to answer "who gave
     * this person authority, and when".
     */
    await writeAudit({
      entityType: "user",
      entityId: created._id,
      entityLabel: name,
      action: "created",
      field: "role",
      newValue: role,
      performedBy: userDoc._id,
      performedByName: userDoc.name,
      notes: permissions.join(", "),
    });

    const { password: _pw, ...safe } = created.toObject();
    void _pw;
    return NextResponse.json(safe, { status: 201 });
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict("That email is already in use");
    throw err;
  }
}
