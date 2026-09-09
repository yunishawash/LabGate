import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole, requireSession } from "@/lib/requireSession";
import {
  badRequest, containsRegex, dateRange, oid, paging, readJson, str, oneOf,
} from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import LabProduct from "@/models/LabProduct";
import LabCustomer from "@/models/LabCustomer";
import { createLabSample } from "@/lib/labSample";
import { notifyLabFail } from "@/lib/labNotify";
import { scoreResults } from "@/lib/labScore";
import { LAB_SHIFTS, LAB_STATUSES, LAB_DECISIONS } from "@/lib/labConstants";

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;

  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = { isActive: true };

  // Every id is validated before it reaches the query. The CMMS cast these
  // straight through, so a malformed id returned a 500 instead of a 400.
  const idFilters: [string, string][] = [
    ["product", "productId"],
    ["customer", "customerId"],
    ["parameterId", "results.parameterId"],
    ["orderId", "orderId"],
  ];
  for (const [param, field] of idFilters) {
    const raw = searchParams.get(param);
    if (!raw || raw === "all") continue;
    const id = oid(raw);
    if (!id) return badRequest(`Invalid ${param}`);
    filter[field] = id;
  }

  const status = searchParams.get("status");
  if (status && status !== "all") filter.overallStatus = oneOf(status, LAB_STATUSES, "pass");

  const shift = searchParams.get("shift");
  if (shift && shift !== "all") filter.shift = oneOf(shift, LAB_SHIFTS, "");

  const batchId = searchParams.get("batchId");
  if (batchId) filter.batchId = containsRegex(batchId);

  // Free-text search spans sample number, batch and order number — the three
  // things a person actually has in hand when chasing a delivery.
  const search = searchParams.get("search");
  if (search) {
    const rx = containsRegex(search);
    filter.$or = [{ sampleNumber: rx }, { batchId: rx }, { orderNumber: rx }];
  }

  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  if (range) filter.sampleDate = range;

  // Higher ceiling than the default 200: a customer's quality-trend chart
  // (CustomerQualityProfile) asks for up to 300 samples in one page, not the
  // paginated Results-tab table this default protects.
  const { page, limit, skip } = paging(searchParams, 25, 500);

  const [samples, total] = await Promise.all([
    LabSample.find(filter).sort({ sampleDate: -1 }).skip(skip).limit(limit).lean(),
    LabSample.countDocuments(filter),
  ]);

  return NextResponse.json({ samples, total, page, limit });
}

export async function POST(req: NextRequest) {
  await connectDB();
  // Recording a QC result is the lab's job. The CMMS let ANY signed-in user
  // create a sample.
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;
  const { userDoc } = check;

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const productId = oid(body.productId);
  if (!productId) return badRequest("A valid productId is required");

  const sampleDate = new Date(str(body.sampleDate, 40));
  if (Number.isNaN(sampleDate.getTime())) return badRequest("A valid sampleDate is required");

  const inputResults = Array.isArray(body.results) ? body.results : [];
  if (!inputResults.length) return badRequest("At least one result is required");

  const cleanResults: { parameterId: string; value: number }[] = [];
  for (const r of inputResults) {
    const row = r as { parameterId?: unknown; value?: unknown };
    const pid = oid(row.parameterId);
    const value = Number(row.value);
    if (!pid) return badRequest("Every result needs a valid parameterId");
    if (!Number.isFinite(value)) return badRequest("Every result must be a finite number");
    cleanResults.push({ parameterId: String(pid), value });
  }

  const product = (await LabProduct.findOne({ _id: productId, isActive: true })
    .select("name")
    .lean()) as { name?: string } | null;
  if (!product) return badRequest("Unknown product");

  let customer: { _id: unknown; name?: string } | null = null;
  const customerId = body.customerId ? oid(body.customerId) : null;
  if (body.customerId && !customerId) return badRequest("Invalid customerId");
  if (customerId) {
    customer = (await LabCustomer.findOne({ _id: customerId, isActive: true })
      .select("name")
      .lean()) as { _id: unknown; name?: string } | null;
    if (!customer) return badRequest("Unknown customer");
  }

  // The verdict is computed here from the product's own thresholds. Whatever
  // status the client sent is ignored entirely.
  const { results, overallStatus } = await scoreResults(String(productId), cleanResults);

  /**
   * The human sign-off on a SAMPLE — separate from stage 7, which signs off on
   * an ORDER (SPEC §14.10). Re-verified from the session, never trusted from
   * the body. Widened from the CMMS's admin-only to include the technical
   * manager, which is who the field was always documented as belonging to.
   */
  const canDecide = userDoc.role === "admin" || userDoc.role === "technical_manager";
  const decision = body.finalDecision ? oneOf(body.finalDecision, LAB_DECISIONS, "pending") : null;
  const decisionFields =
    decision && decision !== "pending" && canDecide
      ? {
          finalDecision: decision,
          finalDecisionNote: str(body.finalDecisionNote, 1000),
          finalDecisionById: userDoc._id,
          finalDecisionByName: userDoc.name,
          finalDecisionAt: new Date(),
        }
      : {};

  const sample = await createLabSample({
    productId,
    product: product.name || "",
    customerId: customerId || null,
    customer: customer?.name || "",
    sampleDate,
    shift: oneOf(body.shift, LAB_SHIFTS, ""),
    batchId: str(body.batchId, 80),
    testedById: userDoc._id,
    testedByName: userDoc.name,
    results,
    overallStatus,
    notes: str(body.notes, 2000),
    ...decisionFields,
  });

  // Only a true out-of-range result raises an alert — a "warning" is still
  // inside the accepted range, just close to a limit.
  if (overallStatus === "fail") {
    notifyLabFail(sample).catch((err) => console.error("[samples POST] notifyLabFail:", err));
  }

  return NextResponse.json(sample, { status: 201 });
}
