import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import {
  badRequest, badStrictStr, conflict, containsRegex, readJson, str, strictStr,
  normalizeName, isDuplicateKeyError, paging,
} from "@/lib/apiHelpers";
import LabCustomer from "@/models/LabCustomer";
import LabSample from "@/models/LabSample";

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  // Archived customers are hidden by default — every picker in the app reads
  // this route, and an archived customer must not be selectable. The Customers
  // screen asks for them explicitly so they can be restored.
  const filter: Record<string, unknown> = {};
  if (searchParams.get("includeInactive") !== "true") filter.isActive = true;

  const search = searchParams.get("search");
  if (search) {
    const rx = containsRegex(search);
    filter.$or = [{ name: rx }, { code: rx }, { nameAr: rx }];
  }

  /**
   * Default limit 25 (a real page, for the Customers screen's own table);
   * max 1000 so the pickers scattered around the app — the order dialog, the
   * lab filters, every combobox that needs the WHOLE register to search
   * over — can keep asking for everything with one `limit=1000` rather than
   * pagination logic they have no use for. Below `withStats`, `total` is
   * always the count of the FILTER, not of the page, so "25 of 40" reads
   * correctly regardless of which page a picker or the table asked for.
   */
  const { page, limit, skip } = paging(searchParams, 25, 1000);
  const [customers, total] = await Promise.all([
    LabCustomer.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    LabCustomer.countDocuments(filter),
  ]);

  if (searchParams.get("withStats") !== "true") {
    return NextResponse.json({ customers, total, page, limit });
  }

  // Per-customer QC roll-up. Warnings count as in-spec: they are inside the
  // accepted range, just close to a limit.
  const stats = await LabSample.aggregate([
    { $match: { isActive: true, customerId: { $ne: null } } },
    {
      $group: {
        _id: "$customerId",
        sampleCount: { $sum: 1 },
        lastSampleDate: { $max: "$sampleDate" },
        passCount: { $sum: { $cond: [{ $eq: ["$overallStatus", "pass"] }, 1, 0] } },
        warningCount: { $sum: { $cond: [{ $eq: ["$overallStatus", "warning"] }, 1, 0] } },
        failCount: { $sum: { $cond: [{ $eq: ["$overallStatus", "fail"] }, 1, 0] } },
      },
    },
  ]);

  const byId = new Map(stats.map((s) => [String(s._id), s]));
  const withStats = customers.map((c) => {
    const s = byId.get(String(c._id));
    const total = s?.sampleCount ?? 0;
    return {
      ...c,
      sampleCount: total,
      lastSampleDate: s?.lastSampleDate ?? null,
      passCount: s?.passCount ?? 0,
      warningCount: s?.warningCount ?? 0,
      failCount: s?.failCount ?? 0,
      inSpecPct: total ? Math.round((((s.passCount + s.warningCount) / total) * 100) * 10) / 10 : null,
    };
  });

  return NextResponse.json({ customers: withStats, total, page, limit });
}

/**
 * Creating a customer is an EXPLICIT, permissioned action.
 *
 * The CMMS's equivalent was find-or-create-on-typing: the sample dialog's
 * combobox silently saved whatever a technician typed. Tolerable when a
 * customer was just a label on a test; destructive now that tonnage and
 * approvals hang off the row, because "Al Amal" / "AL AMAL" / "Al-Amal Co."
 * become three customers and split every report three ways (SPEC §10.1b).
 *
 * `sales_manager` owns the register day to day; `general_manager` added
 * 2026-09-07 at the client's request — the GM already sees and can reject
 * every order plant-wide, so withholding the customer list from that same
 * role was a narrower rule than the rest of the system gives them.
 */
export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("sales_manager", "general_manager");
  if (check.error) return check.error;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const name = str(body.name, 200);
  if (!name) return badRequest("A customer name is required");

  const addressCheck = strictStr(body.address, 500, "Address");
  if (!addressCheck.ok) return badStrictStr(addressCheck);
  const notesCheck = strictStr(body.notes, 4000, "Notes");
  if (!notesCheck.ok) return badStrictStr(notesCheck);

  const nameKey = normalizeName(name);

  // Friendly check first, so the user gets the existing name back...
  const existing = await LabCustomer.findOne({ nameKey, isActive: true }).lean();
  if (existing) return conflict(`"${(existing as { name: string }).name}" already exists`);

  try {
    const created = await LabCustomer.create({
      name,
      nameKey,
      nameAr: str(body.nameAr, 200),
      code: str(body.code, 40),
      phone: str(body.phone, 40),
      contactName: str(body.contactName, 120),
      address: addressCheck.value,
      notes: notesCheck.value,
      isActive: true,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    // ...and the partial unique index catches the race the check cannot.
    if (isDuplicateKeyError(err)) return conflict(`"${name}" already exists`);
    throw err;
  }
}
