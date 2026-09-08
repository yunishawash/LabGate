import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireModule, requireRole } from "@/lib/requireSession";
import {
  badRequest, containsRegex, dateRange, oid, paging, readJson, str, oneOf,
} from "@/lib/apiHelpers";
import { createSalesOrder } from "@/lib/salesOrder";
import { writeAudit } from "@/lib/audit";
import { notifyStageEntered } from "@/lib/salesNotify";
import {
  visibilityFilter, andFilters, canCreate, stagesAt,
  type Actor, type OrderLike,
} from "@/lib/salesWorkflow";
import { liveDelegationRoles, orderPermissions, stagesOwnedBy } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import LabCustomer from "@/models/LabCustomer";
import LabProduct from "@/models/LabProduct";
import User from "@/models/User";
import { notAbsentFilter } from "@/lib/requireSession";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { BAG_WEIGHTS } from "@/types";

const ORDER_STATUSES = ["Pending", "Posted", "Rejected"] as const;

export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireModule("orders");
  if (check.error) return check.error;
  const { userDoc } = check;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);

  const { searchParams } = new URL(req.url);

  const userFilter: Record<string, unknown> = {};

  const status = searchParams.get("status");
  if (status && status !== "all") userFilter.status = oneOf(status, ORDER_STATUSES, "Pending");

  const stage = searchParams.get("stage");
  if (stage && stage !== "all") {
    const n = Number(stage);
    if (!Number.isInteger(n) || n < 1 || n > 8) return badRequest("Invalid stage");
    userFilter.currentStageIndex = n;
  }

  /**
   * Used by the Approvals queue to stay properly paginated: it shows every
   * `mine=true` order EXCEPT stage 7, which is the Results Sign-off page's
   * own territory (SPEC §10.1 — different job, different destination). That
   * split used to happen by fetching everything and filtering in the
   * browser, which meant "page 1 of 25" could come back holding fewer than
   * 25 once the stage-7 rows were dropped from it. Excluding server-side
   * keeps a page an actual page.
   *
   * Resolved into `mineFilter`'s own `$in` below rather than written here as
   * a second `currentStageIndex` clause — `andFilters` hoists plain keys with
   * a simple `flat[key] = value`, so a SECOND fragment carrying the same key
   * (mine's `$in`) would silently overwrite this one instead of combining
   * with it. One combined array is correct where two competing conditions on
   * the same field is not.
   */
  let excludeStageN: number | null = null;
  const excludeStage = searchParams.get("excludeStage");
  if (excludeStage) {
    const n = Number(excludeStage);
    if (!Number.isInteger(n) || n < 1 || n > 8) return badRequest("Invalid excludeStage");
    excludeStageN = n;
  }

  const customerId = searchParams.get("customerId");
  if (customerId && customerId !== "all") {
    const id = oid(customerId);
    if (!id) return badRequest("Invalid customerId");
    userFilter.customerId = id;
  }

  const range = dateRange(searchParams.get("from"), searchParams.get("to"));
  if (range) userFilter.orderDate = range;

  // People look for an order by the number THEY wrote down, not the one the
  // system generated — so the reference is searched alongside both.
  const searchFilter: Record<string, unknown> = {};
  const search = searchParams.get("search");
  if (search) {
    const rx = containsRegex(search);
    searchFilter.$or = [{ orderNumber: rx }, { customer: rx }, { referenceNo: rx }];
  }

  // "Waiting on me": live orders sitting at a stage this actor could act on.
  const mineFilter: Record<string, unknown> = {};
  if (searchParams.get("mine") === "true") {
    const owned = stagesOwnedBy(actor.role, delegated);
    let indexes = Array.from(new Set(owned.map((s) => s.index)));
    if (excludeStageN !== null) indexes = indexes.filter((i) => i !== excludeStageN);
    mineFilter.status = "Pending";
    mineFilter.currentStageIndex = { $in: indexes.length ? indexes : [-1] };
  } else if (excludeStageN !== null) {
    // No `mine` in play — nothing else claims `currentStageIndex`, so the
    // plain `$ne` is safe here with no collision to fold it into.
    userFilter.currentStageIndex = { $ne: excludeStageN };
  }

  // Visibility FIRST and always. andFilters keeps its $or from being silently
  // overwritten by the search $or.
  const filter = andFilters(
    visibilityFilter(actor, delegated),
    userFilter,
    searchFilter,
    mineFilter
  );

  const { page, limit, skip } = paging(searchParams);
  const sortField = oneOf(
    searchParams.get("sortField"),
    ["orderDate", "createdAt", "currentStageEnteredAt", "totalWeightKg", "orderNumber"] as const,
    "createdAt"
  );
  const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

  const [orders, total] = await Promise.all([
    SalesOrder.find(filter).sort({ [sortField]: sortOrder }).skip(skip).limit(limit).lean(),
    SalesOrder.countDocuments(filter),
  ]);

  // The client never re-derives authority — it renders what the server grants.
  const withPermissions = await Promise.all(
    orders.map(async (o) => {
      const like = o as unknown as OrderLike & { createdById: unknown };
      const permissions = await orderPermissions(
        {
          status: like.status,
          currentStageIndex: like.currentStageIndex,
          createdById: String(like.createdById),
          steps: like.steps,
        },
        actor,
        delegated
      );
      return { ...o, permissions };
    })
  );

  /**
   * Who holds each chain role, in ONE query rather than per row. The list needs
   * a name against "waiting on", and computing that per order would be N
   * lookups for a page of 25.
   */
  const chainRoles = Array.from(new Set(SALES_STAGES.map((s) => s.role)));
  const holders = (await User.find({ role: { $in: chainRoles }, isActive: true })
    .select("name role isAbsent absentFrom absentTo")
    .lean()) as {
      _id: unknown; name: string; role: string;
      isAbsent: boolean; absentFrom: Date | null; absentTo: Date | null;
    }[];

  const now = new Date();
  const present = new Set(
    (await User.find({ role: { $in: chainRoles }, isActive: true, ...notAbsentFilter(now) })
      .select("_id").lean()).map((u) => String((u as { _id: unknown })._id))
  );

  const roleHolders: Record<string, { id: string; name: string; away: boolean; isYou: boolean }[]> = {};
  for (const h of holders) {
    (roleHolders[h.role] ??= []).push({
      id: String(h._id),
      name: h.name,
      away: !present.has(String(h._id)),
      isYou: String(h._id) === actor.id,
    });
  }

  return NextResponse.json({ orders: withPermissions, total, page, limit, roleHolders });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const check = await requireRole("sales_coordinator", "sales_manager");
  if (check.error) return check.error;
  const { userDoc } = check;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  if (!canCreate(actor)) return badRequest("This role cannot raise an order");

  const body = await readJson(req);
  if (!body) return badRequest("Invalid request body");

  const customerId = oid(body.customerId);
  if (!customerId) return badRequest("A valid customerId is required");

  const customer = (await LabCustomer.findOne({ _id: customerId, isActive: true })
    .select("name nameAr")
    .lean()) as { name?: string; nameAr?: string } | null;
  if (!customer) return badRequest("Unknown customer");

  const orderDate = new Date(str(body.orderDate, 40));
  if (Number.isNaN(orderDate.getTime())) return badRequest("A valid orderDate is required");

  let deliveryDate: Date | null = null;
  if (body.deliveryDate) {
    const d = new Date(str(body.deliveryDate, 40));
    if (Number.isNaN(d.getTime())) return badRequest("Invalid deliveryDate");
    deliveryDate = d;
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) return badRequest("An order needs at least one line");
  if (rawLines.length > 50) return badRequest("An order cannot have more than 50 lines");

  const lines: Record<string, unknown>[] = [];
  let totalBags = 0;
  let totalWeightKg = 0;

  for (const raw of rawLines) {
    const row = raw as { productId?: unknown; bagWeightKg?: unknown; bagCount?: unknown; note?: unknown };

    const productId = oid(row.productId);
    if (!productId) return badRequest("Every line needs a valid productId");

    const bagWeightKg = Number(row.bagWeightKg);
    if (!(BAG_WEIGHTS as readonly number[]).includes(bagWeightKg)) {
      return badRequest(`Bag weight must be one of ${BAG_WEIGHTS.join(", ")} kg`);
    }

    const bagCount = Number(row.bagCount);
    if (!Number.isInteger(bagCount) || bagCount < 1) {
      return badRequest("Every line needs a whole bag count of at least 1");
    }

    const product = (await LabProduct.findOne({ _id: productId, isActive: true })
      .select("name nameAr")
      .lean()) as { name?: string; nameAr?: string } | null;
    if (!product) return badRequest("Unknown product on one of the lines");

    // Computed here, never taken from the client — the same rule the lab
    // applies to a scored result.
    const lineWeightKg = bagWeightKg * bagCount;
    totalBags += bagCount;
    totalWeightKg += lineWeightKg;

    lines.push({
      productId,
      product: product.name || "",
      productAr: product.nameAr || "",
      bagWeightKg,
      bagCount,
      lineWeightKg,
      note: str(row.note, 200),
    });
  }

  const order = await createSalesOrder(
    {
      customerId,
      customer: customer.name || "",
      customerAr: customer.nameAr || "",
      referenceNo: str(body.referenceNo, 60),
      orderDate,
      deliveryDate,
      notes: str(body.notes, 2000),
      lines,
      totalBags,
      totalWeightKg,
    },
    { _id: userDoc._id, name: userDoc.name }
  );

  /**
   * Every transition writes its own audit entry, but nothing was writing the
   * first one — the trail began at "sales manager approved" with no record of
   * who raised the order or when. A chain of responsibility that omits its own
   * origin is not a chain.
   */
  const created = order as unknown as { _id: unknown; orderNumber: string };
  await writeAudit({
    entityType: "sales_order",
    entityId: String(created._id),
    entityLabel: created.orderNumber,
    action: "created",
    field: "created",
    oldValue: "",
    newValue: 2,
    performedBy: userDoc._id,
    performedByName: userDoc.name,
    notes: `${totalBags} bags · ${(totalWeightKg / 1000).toFixed(3)} t · ${lines.length} line(s)`,
  });

  notifyStageEntered(
    order as unknown as Parameters<typeof notifyStageEntered>[0],
    2,
    userDoc._id
  ).catch((e) => console.error("[orders POST] notifyStageEntered:", e));

  return NextResponse.json(order, { status: 201 });
}

/** Exported for the detail route, so both agree on what a stage looks like. */
export { stagesAt };
