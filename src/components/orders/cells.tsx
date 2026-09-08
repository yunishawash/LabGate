"use client";
import { Check, Clock, X, MinusCircle, FlaskConical, Scale } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { formatDuration } from "@/lib/utils";
import { agingToneFrom, LATE_HOURS, WARN_HOURS } from "@/lib/aging";
import { useNow } from "@/lib/useNow";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { SALES_STAGES, stagesAt, type StageDef } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";

export interface OrderRow {
  _id: string;
  orderNumber: string;
  referenceNo?: string;
  customer: string;
  customerAr?: string;
  orderDate: string;
  totalBags: number;
  totalWeightKg: number;
  status: "Pending" | "Posted" | "Rejected";
  currentStageIndex: number;
  currentStageEnteredAt: string;
  labOverallStatus?: string;
  actualNetWeightKg?: number | null;
  varianceKg?: number | null;
  variancePct?: number | null;
  rejection?: { reason?: string; byName?: string; stageIndex?: number | null };
  steps: {
    stageKey: string; stageIndex: number; role: string; kind: string; status: string;
    actedByName?: string; actedAt?: string | null; actedAs?: string; actedForRole?: string; note?: string;
  }[];
  permissions?: { actingAs?: { kind: string; forRole: string } | null; stalled?: { stageKey: string; role: string } | null };
}

export type RoleHolders = Record<string, { id: string; name: string; away: boolean; isYou: boolean }[]>;

/**
 * How long an order has sat where it is.
 *
 * Slate under a day, amber to two days, RED past 48 hours. This one signal is
 * what turns the module from a record into a tool — it is the only thing on the
 * screen that says "somebody is holding this up".
 */
export function agingTone(enteredAt: string, now: number): "calm" | "warn" | "late" {
  return agingToneFrom(enteredAt, now);
}

/** Re-exported so callers get the thresholds from the same import as the tone. */
export { LATE_HOURS, WARN_HOURS };

const TONE_TEXT = { calm: "text-slate-400", warn: "text-amber-600", late: "text-red-600 font-medium" };

/** "4 / 8 · General Manager" — the compact form for tight spaces. */
export function StageBadge({ index }: { index: number }) {
  const { lang } = useLang();
  const stage = SALES_STAGES.find((s) => s.index === index);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <bdi className="font-mono text-slate-400">{index}/8</bdi>
      <span className="text-slate-600">{stage ? (lang === "ar" ? stage.ar : stage.en) : "—"}</span>
    </span>
  );
}

/**
 * The "Current Stage" cell from the mockup: two lines in a tinted box — the
 * stage, then the LAST THING THAT HAPPENED with its timestamp. A badge alone
 * says where an order is; this says where it is and how it got there.
 */
export function CurrentStageCell({ order }: { order: OrderRow }) {
  const { lang, t } = useLang();
  const now = useNow();

  if (order.status === "Rejected") {
    const stage = SALES_STAGES.find((s) => s.index === (order.rejection?.stageIndex ?? 0));
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/70 px-2.5 py-1.5 min-w-56">
        <div className="flex items-center gap-1.5 text-sm font-medium text-red-800">
          <X size={13} className="flex-shrink-0" />
          {t("Rejected", "مرفوضة")}
          {stage && <span className="font-normal text-red-600">· {lang === "ar" ? stage.ar : stage.en}</span>}
        </div>
        <p className="text-xs text-red-700/80 mt-0.5 line-clamp-2">{order.rejection?.reason}</p>
      </div>
    );
  }

  if (order.status === "Posted") {
    const t8 = order.steps.find((s) => s.stageIndex === 8);
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 min-w-56">
        <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
          <Check size={13} className="flex-shrink-0" />
          {t("Posted", "مرحّلة")}
        </div>
        <div className="text-xs text-emerald-700/80 mt-0.5 flex items-center gap-1.5 flex-wrap">
          {order.actualNetWeightKg != null && (
            <bdi className="tabular-nums">
              {(order.actualNetWeightKg / 1000).toFixed(3)} {t("t", "طن")}
              {order.variancePct != null && (
                <span className={Math.abs(order.variancePct) <= 0.5 ? "" : " font-medium"}>
                  {" "}({order.variancePct > 0 ? "+" : ""}{order.variancePct}%)
                </span>
              )}
            </bdi>
          )}
          {t8?.actedByName && <span>· {t8.actedByName}</span>}
        </div>
      </div>
    );
  }

  const stage = SALES_STAGES.find((s) => s.index === order.currentStageIndex);
  // The most recent thing that actually happened, whatever stage it was at.
  const last = [...order.steps]
    .filter((s) => s.actedAt)
    .sort((a, b) => new Date(b.actedAt!).getTime() - new Date(a.actedAt!).getTime())[0];
  const tone = now === null ? "calm" : agingTone(order.currentStageEnteredAt, now);
  const waited = now === null ? "" : formatDuration(now - new Date(order.currentStageEnteredAt).getTime(), lang);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 min-w-56">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
        <span className="font-mono text-xs text-slate-400">{order.currentStageIndex}.</span>
        {stage ? (lang === "ar" ? stage.ar : stage.en) : "—"}
        {order.currentStageIndex === 6 && <FlaskConical size={12} className="text-cyan-600" />}
        {order.currentStageIndex === 8 && <Scale size={12} className="text-orange-600" />}
      </div>
      <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
        {last?.actedByName ? (
          <span className="text-slate-500">
            <Check size={10} className="inline align-[-1px] text-emerald-600" />{" "}
            {/* Stage 1 is a creation, not an approval — saying "approved by" on a
                brand-new order claims a signature that nobody gave. */}
            {last.kind === "create" ? t("Raised by", "أنشأها") : t("Approved by", "اعتمدها")}{" "}
            {last.actedByName}
            {last.actedAs && last.actedAs !== "primary" && last.actedAs !== "admin" && (
              <span className="text-amber-700">
                {" "}({t("on behalf of", "بالإنابة عن")}{" "}
                {ROLE_LABELS[last.actedForRole as UserRole]?.[lang] ?? last.actedForRole})
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-400">{t("Awaiting first approval", "في انتظار أول اعتماد")}</span>
        )}
        {waited && (
          <span className={`inline-flex items-center gap-1 ${TONE_TEXT[tone]}`}>
            <Clock size={10} />
            <bdi>{waited}</bdi>
          </span>
        )}
      </div>
      {order.currentStageIndex >= 7 && order.labOverallStatus && (
        <div className="mt-1">
          <QcStatusBadge status={order.labOverallStatus} size="xs" />
        </div>
      )}
    </div>
  );
}

function Avatar({ name, away, isYou }: { name: string; away: boolean; isYou: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
  return (
    <span
      className={
        "w-7 h-7 rounded-full grid place-items-center text-[10px] font-semibold flex-shrink-0 " +
        (isYou ? "bg-sky-600 text-white" : away ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600")
      }
      title={name}
    >
      {initials || "?"}
    </span>
  );
}

/**
 * "Waiting for approval from" — avatar, person, role. Says **You** when the
 * viewer is the one holding it up, shows BOTH signatories at stage 7, and marks
 * a stage whose owner is away with no deputy, which is the one case that goes
 * nowhere on its own.
 */
export function WaitingOnCell({ order, roleHolders }: { order: OrderRow; roleHolders: RoleHolders }) {
  const { lang, t } = useLang();

  if (order.status !== "Pending") return <span className="text-slate-300">—</span>;

  const live = stagesAt(order.currentStageIndex).filter(
    (s) => order.steps.find((st) => st.stageKey === s.key)?.status === "pending"
  );
  if (!live.length) return <span className="text-slate-300">—</span>;

  const stalledRole = order.permissions?.stalled?.role;

  const entry = (stage: StageDef) => {
    const holders = roleHolders[stage.role] ?? [];
    const you = holders.find((h) => h.isYou);
    const shown = you ?? holders[0];
    const allAway = holders.length > 0 && holders.every((h) => h.away);

    return (
      <div key={stage.key} className="flex items-center gap-2 min-w-0">
        {shown ? <Avatar name={shown.name} away={shown.away} isYou={!!you} /> : (
          <span className="w-7 h-7 rounded-full bg-red-100 text-red-600 grid place-items-center flex-shrink-0">
            <MinusCircle size={13} />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <div className="text-sm text-slate-800 truncate">
            {you ? t("You", "أنت") : shown?.name ?? t("Nobody holds this role", "لا أحد يشغل هذا الدور")}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {ROLE_LABELS[stage.role as UserRole]?.[lang] ?? stage.role}
          </div>
          {(allAway || (!shown && true)) && (
            <div className="text-xs text-amber-700">
              {stage.deputyRole
                ? t("away · deputy may act", "غائب · يمكن للنائب التصرّف")
                : t("away · no deputy for this stage", "غائب · لا نائب لهذه المرحلة")}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {live.map(entry)}
      {live.length > 1 && (
        <p className="text-xs text-slate-500">
          {t("Both signatures required", "التوقيعان مطلوبان")}
        </p>
      )}
      {stalledRole && (
        <p className="text-xs text-amber-700 font-medium">
          {t("Stalled — nobody can act", "متوقّفة — لا أحد يستطيع التصرّف")}
        </p>
      )}
    </div>
  );
}
