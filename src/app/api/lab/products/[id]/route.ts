import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid, readJson, str, conflict, isDuplicateKeyError } from "@/lib/apiHelpers";
import LabProduct from "@/models/LabProduct";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const current = (await LabProduct.findOne({ _id: id, isActive: true })
    .select("parentId")
    .lean()) as { parentId?: unknown } | null;
  if (!current) return notFound("Product not found");

  const update: Record<string, unknown> = {};
  if ("name" in body) {
    const name = str(body.name, 120);
    if (!name) return badRequest("A product name is required");
    update.name = name;
  }
  if ("nameAr" in body) update.nameAr = str(body.nameAr, 120);

  /**
   * Flipping this changes the route of FUTURE orders only. Orders already in
   * flight keep the `labRequired` they were created with — see the field's
   * note on the SalesOrder model for why that has to be frozen rather than
   * re-derived.
   *
   * It is a decision about the TYPE. A request to set it on a grade is
   * refused rather than quietly applied: "Super needs a lab test but Fakher
   * does not" is not a sentence the plant has, and honouring it would split
   * one product's orders across two routes with nothing on screen explaining
   * why.
   */
  let cascade: boolean | null = null;
  if ("orderRequiresLabTest" in body) {
    if (current.parentId) {
      return badRequest(
        "Whether a lab test applies is set on the product type, not on an individual grade."
      );
    }
    cascade = body.orderRequiresLabTest !== false;
    update.orderRequiresLabTest = cascade;
  }

  // A rename can collide with another row's unique name. Surface that as a
  // readable 409 rather than letting a raw E11000 escape as a 500.
  let updated;
  try {
    updated = await LabProduct.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: update },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKeyError(err)) return conflict(`"${update.name}" is already in use`);
    throw err;
  }

  if (!updated) return notFound("Product not found");

  /**
   * Push the type's answer down onto its grades.
   *
   * They hold a denormalized copy so `buildOrderLines` can answer the question
   * with the one query it already makes per line instead of climbing the tree
   * on the hot path. Denormalized data has to be kept in sync by somebody, and
   * this is that somebody — a single `updateMany` on an edit that happens
   * about never.
   */
  if (cascade !== null) {
    await LabProduct.updateMany(
      { parentId: id },
      { $set: { orderRequiresLabTest: cascade } }
    );
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  /**
   * A type cannot be archived while grades still hang off it.
   *
   * Archiving it would leave them orphaned: still active, still offered on the
   * order dialog, but under a heading that no longer exists — and carrying a
   * `orderRequiresLabTest` copy that nothing can cascade into again. Say so
   * instead, and name the count, because the administrator's next question is
   * "how many".
   */
  const liveGrades = await LabProduct.countDocuments({ parentId: id, isActive: true });
  if (liveGrades > 0) {
    return conflict(
      `This product type still has ${liveGrades} grade(s) under it. Remove them first.`
    );
  }

  const updated = await LabProduct.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false } }
  ).lean();

  if (!updated) return notFound("Product not found");
  return NextResponse.json({ success: true });
}
