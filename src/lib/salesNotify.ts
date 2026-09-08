import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import Notification from "@/models/Notification";
import User from "@/models/User";
import Delegation from "@/models/Delegation";
import { pushToUser } from "@/lib/sseClients";
import { notAbsentFilter } from "@/lib/requireSession";
import { stagesAt, SALES_STAGES, type StageDef } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";

interface OrderLite {
  _id: unknown;
  orderNumber: string;
  customer?: string;
  customerAr?: string;
  createdById?: unknown;
  totalWeightKg?: number;
}

type Recipient = { id: string; reason: "primary" | "deputy" | "delegate" };

/**
 * Deliver one notification and wake the person's open tabs.
 *
 * Never throws into the caller: an approval must not fail because a
 * notification could not be written. The failure is logged rather than
 * swallowed — a silent gap in the fan-out looks exactly like "nobody was
 * supposed to be told", which is the one thing this module must never fake.
 */
async function deliver(
  userId: string,
  fields: {
    type: string; title: string; titleAr: string;
    message: string; messageAr: string; salesOrderId: unknown;
  }
) {
  try {
    await Notification.create({ userId, ...fields, isRead: false });
    pushToUser(userId);
  } catch (err) {
    console.error("[salesNotify] deliver:", err);
  }
}

const roleLabel = (role: string, lang: "en" | "ar") =>
  ROLE_LABELS[role as UserRole]?.[lang] ?? role;

/**
 * Who can actually act on this stage right now.
 *
 * Not simply "everyone with the role": the deputy is only a recipient while
 * every primary holder is away, because that is exactly when the deputy is the
 * one who can move the order. Telling a deputy about an order they are not
 * allowed to touch trains them to ignore the bell.
 */
async function actorsFor(stage: StageDef, now = new Date()): Promise<Recipient[]> {
  await connectDB();
  const out: Recipient[] = [];
  const seen = new Set<string>();

  const add = (id: unknown, reason: Recipient["reason"]) => {
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, reason });
  };

  const primaries = (await User.find({
    role: stage.role, isActive: true, ...notAbsentFilter(now),
  }).select("_id").lean()) as { _id: unknown }[];
  for (const u of primaries) add(u._id, "primary");

  // A live named delegation is authority the primary handed over deliberately,
  // so it counts whether or not the primary is present.
  const delegations = (await Delegation.find({
    role: stage.role, isActive: true,
    from: { $lte: now }, to: { $gte: now },
  }).select("toUserId").lean()) as { toUserId: unknown }[];
  for (const d of delegations) add(d.toUserId, "delegate");

  if (!primaries.length && stage.deputyRole) {
    const deputies = (await User.find({
      role: stage.deputyRole, isActive: true, ...notAbsentFilter(now),
    }).select("_id").lean()) as { _id: unknown }[];
    for (const u of deputies) add(u._id, "deputy");
  }

  return out;
}

/**
 * The order has arrived at a stage — tell whoever can move it.
 *
 * Stage 7 holds two stages, so both signatories are told; that is the same
 * "one stage, many slots" shape the engine uses everywhere else, not a special
 * case here.
 *
 * `exclude` is the person who just acted. Someone who holds two consecutive
 * stages would otherwise be notified about the order they just pushed forward,
 * which reads as a system that is not paying attention.
 */
export async function notifyStageEntered(
  order: OrderLite,
  stageIndex: number,
  exclude?: unknown
) {
  await connectDB();
  const stages = stagesAt(stageIndex);
  if (!stages.length) return;

  const excludeId = exclude ? String(exclude) : "";
  const seen = new Set<string>();
  const stalledRoles: string[] = [];

  for (const stage of stages) {
    const recipients = await actorsFor(stage);

    /**
     * The zero-recipient rule (SPEC §14.7). Nobody active holds the role and no
     * deputy or delegate covers it: the order parks here indefinitely with
     * nobody watching. Silence would be the worst possible outcome, so admins
     * are told instead — and told which role is missing.
     */
    if (!recipients.length) {
      stalledRoles.push(stage.role);
      continue;
    }

    for (const r of recipients) {
      if (r.id === excludeId || seen.has(r.id)) continue;
      seen.add(r.id);

      const onBehalf = r.reason === "primary" ? "" : ` (${roleLabel(stage.role, "en")})`;
      const onBehalfAr = r.reason === "primary" ? "" : ` (${roleLabel(stage.role, "ar")})`;

      await deliver(r.id, {
        type: "order_pending",
        title: `Waiting for your approval${onBehalf}`,
        titleAr: `في انتظار اعتمادك${onBehalfAr}`,
        message: `${order.orderNumber} · ${order.customer ?? ""} — ${stage.en}`,
        messageAr: `${order.orderNumber} · ${order.customerAr || order.customer || ""} — ${stage.ar}`,
        salesOrderId: order._id,
      });
    }
  }

  if (stalledRoles.length) await notifyStalled(order, stageIndex, stalledRoles);
}

/** Nobody can act. Admins hear about it, by name of the missing role. */
async function notifyStalled(order: OrderLite, stageIndex: number, roles: string[]) {
  const admins = (await User.find({ role: "admin", isActive: true })
    .select("_id").lean()) as { _id: unknown }[];
  if (!admins.length) return;

  const en = roles.map((r) => roleLabel(r, "en")).join(", ");
  const ar = roles.map((r) => roleLabel(r, "ar")).join("، ");

  for (const a of admins) {
    await deliver(String(a._id), {
      type: "order_stalled",
      title: "An order is stalled",
      titleAr: "طلبية متوقفة",
      message: `No active user holds: ${en} — ${order.orderNumber} is stuck at stage ${stageIndex}.`,
      messageAr: `لا يوجد مستخدم فعّال في هذا الدور: ${ar} — الطلبية ${order.orderNumber} متوقّفة عند المرحلة ${stageIndex}.`,
      salesOrderId: order._id,
    });
  }
}

/**
 * Rejection is terminal, so everyone with a stake hears it once: the person who
 * raised the order, everyone who already signed, and the General Manager. They
 * each acted on something that is now dead, and finding that out by opening the
 * list next week is how a chain loses its credibility.
 */
export async function notifyRejected(
  order: OrderLite & { steps?: { actedById?: unknown }[]; rejection?: { reason?: string; byName?: string } },
  rejectedBy: unknown
) {
  await connectDB();
  const ids = new Set<string>();

  if (order.createdById) ids.add(String(order.createdById));
  for (const s of order.steps ?? []) if (s.actedById) ids.add(String(s.actedById));

  const gms = (await User.find({ role: "general_manager", isActive: true })
    .select("_id").lean()) as { _id: unknown }[];
  for (const g of gms) ids.add(String(g._id));

  ids.delete(String(rejectedBy));

  const reason = order.rejection?.reason ?? "";
  for (const id of ids) {
    await deliver(id, {
      type: "order_rejected",
      title: "Order rejected",
      titleAr: "طلبية مرفوضة",
      message: `${order.orderNumber} — ${order.rejection?.byName ?? ""}${reason ? `: ${reason}` : ""}`,
      messageAr: `${order.orderNumber} — ${order.rejection?.byName ?? ""}${reason ? `: ${reason}` : ""}`,
      salesOrderId: order._id,
    });
  }
}

/** Posted: the person who raised it wanted to know, and the GM tracks throughput. */
export async function notifyPosted(
  order: OrderLite & { actualNetWeightKg?: number | null; variancePct?: number | null },
  postedBy: unknown
) {
  await connectDB();
  const ids = new Set<string>();
  if (order.createdById) ids.add(String(order.createdById));

  const gms = (await User.find({ role: "general_manager", isActive: true })
    .select("_id").lean()) as { _id: unknown }[];
  for (const g of gms) ids.add(String(g._id));

  ids.delete(String(postedBy));

  const tons = order.actualNetWeightKg != null
    ? `${(order.actualNetWeightKg / 1000).toFixed(3)} t`
    : "";
  const variance = order.variancePct != null ? ` (${order.variancePct > 0 ? "+" : ""}${order.variancePct}%)` : "";

  for (const id of ids) {
    await deliver(id, {
      type: "order_posted",
      title: "Order posted",
      titleAr: "طلبية مرحّلة",
      message: `${order.orderNumber} · ${tons}${variance}`,
      messageAr: `${order.orderNumber} · ${tons}${variance}`,
      salesOrderId: order._id,
    });
  }
}

/** Exported for the stalled-order sweep and tests. */
export { SALES_STAGES, mongoose };
