"use client";
import { Check, Clock, X, Minus, FlaskConical, Scale, PenLine } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { SALES_STAGES, type StageDef } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { OrderRow } from "@/components/orders/cells";

type Step = OrderRow["steps"][number];
type NodeState = "done" | "current" | "pending" | "rejected" | "skipped";

/**
 * The chain of responsibility, rendered.
 *
 * This component is the answer to the client's third requirement — "a clear,
 * visible sequence of who is responsible" — so it is deliberately verbose where
 * a status pill would be terser: every completed stage names the person, the
 * moment, and whether they signed in their own right or standing in for someone.
 *
 * Layout uses logical properties ONLY (`start-`, `ms-`, never `left-`/`ml-`).
 * Under `dir="rtl"` the rail moves to the right edge and the chain reads
 * right-to-left with no extra CSS and no second code path.
 */
export function ApprovalTimeline({ order }: { order: OrderRow }) {
  const { lang, t } = useLang();
  const now = useNow();

  // Stage 7 holds two steps. Grouping by index means the dual gate needs no
  // special branch here either — it is just a stage that owns two rows.
  const byIndex = new Map<number, StageDef[]>();
  for (const s of SALES_STAGES) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, []);
    byIndex.get(s.index)!.push(s);
  }
  const indexes = [...byIndex.keys()].sort((a, b) => a - b);

  const stepOf = (key: string) => order.steps.find((s) => s.stageKey === key);

  const stateOf = (i: number): NodeState => {
    const steps = byIndex.get(i)!.map((s) => stepOf(s.key));
    if (steps.some((s) => s?.status === "rejected")) return "rejected";
    if (steps.every((s) => s?.status === "approved" || s?.status === "completed")) return "done";
    if (steps.some((s) => s?.status === "skipped")) return "skipped";
    if (i === order.currentStageIndex && order.status === "Pending") return "current";
    return "pending";
  };

  return (
    <ol className="relative">
      {/* The rail. `start-` so RTL moves it to the right on its own. */}
      <span className="absolute start-[13px] top-4 bottom-4 w-0.5 bg-slate-200 rounded-full" aria-hidden />
      {indexes.map((i) => (
        <TimelineNode
          key={i}
          index={i}
          stages={byIndex.get(i)!}
          state={stateOf(i)}
          order={order}
          stepOf={stepOf}
          lang={lang}
          t={t}
          now={now}
        />
      ))}
    </ol>
  );
}

const NODE_STYLE: Record<NodeState, string> = {
  done: "bg-emerald-500 text-white border-emerald-500",
  current: "bg-sky-500 text-white border-sky-500 ring-4 ring-sky-100",
  pending: "bg-white text-slate-300 border-slate-200",
  rejected: "bg-red-500 text-white border-red-500",
  skipped: "bg-slate-100 text-slate-300 border-slate-200",
};

const NODE_ICON: Record<NodeState, typeof Check> = {
  done: Check, current: Clock, pending: Minus, rejected: X, skipped: Minus,
};

function TimelineNode({
  index, stages, state, order, stepOf, lang, t, now,
}: {
  index: number;
  stages: StageDef[];
  state: NodeState;
  order: OrderRow;
  stepOf: (key: string) => Step | undefined;
  lang: "en" | "ar";
  t: (en: string, ar: string) => string;
  now: number | null;
}) {
  const Icon = NODE_ICON[state];
  const dual = stages.length > 1;
  const signed = stages.filter((s) => {
    const st = stepOf(s.key)?.status;
    return st === "approved" || st === "completed";
  }).length;

  return (
    <li className="relative ps-11 pb-5 last:pb-0">
      <span
        className={`absolute start-0 top-0.5 w-[27px] h-[27px] rounded-full border-2 grid place-items-center ${NODE_STYLE[state]}`}
      >
        <Icon size={14} strokeWidth={3} />
      </span>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-slate-400">{index}/8</span>
        <span className={`font-medium ${state === "pending" || state === "skipped" ? "text-slate-400" : "text-slate-900"}`}>
          {lang === "ar"
            ? stages[0].groupAr ?? stages[0].ar
            : stages[0].groupEn ?? stages[0].en}
        </span>
        {index === 6 && <FlaskConical size={13} className="text-cyan-600" />}
        {index === 8 && <Scale size={13} className="text-orange-600" />}
        {dual && (
          <span
            className={
              "text-xs px-1.5 py-0.5 rounded-full " +
              (signed === 2 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")
            }
          >
            <bdi>{signed}/2</bdi> {t("signatures", "توقيع")}
          </span>
        )}
        {state === "current" && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700">
            {t("Here now", "هنا الآن")}
            {now !== null && (
              <> · <bdi>{formatDuration(now - new Date(order.currentStageEnteredAt).getTime(), lang)}</bdi></>
            )}
          </span>
        )}
      </div>

      {/* A dual stage lists its signatories; a single one renders inline. */}
      <div className={dual ? "mt-1.5 space-y-1.5" : "mt-0.5"}>
        {stages.map((stage) => (
          <SignatureLine
            key={stage.key}
            stage={stage}
            step={stepOf(stage.key)}
            indented={dual}
            lang={lang}
            t={t}
          />
        ))}
      </div>

      {index === 6 && order.labOverallStatus && (
        <div className="mt-1.5">
          <QcStatusBadge status={order.labOverallStatus} size="xs" />
        </div>
      )}

      {index === 8 && order.actualNetWeightKg != null && (
        <WeighSummary order={order} t={t} />
      )}

      {state === "rejected" && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm font-medium text-red-800">
            {t("Rejected by", "رفضها")} {order.rejection?.byName}
          </p>
          <p className="text-sm text-red-700 mt-0.5 break-words whitespace-pre-wrap">{order.rejection?.reason}</p>
          <p className="text-xs text-red-600/80 mt-1.5">
            {t(
              "This order is closed. A new order must be raised.",
              "هذه الطلبية مغلقة. يجب إنشاء طلبية جديدة."
            )}
          </p>
        </div>
      )}
    </li>
  );
}

/** One signature: who, when, standing in for whom, and what they wrote. */
function SignatureLine({
  stage, step, indented, lang, t,
}: {
  stage: StageDef; step?: Step; indented: boolean;
  lang: "en" | "ar"; t: (en: string, ar: string) => string;
}) {
  const roleLabel = ROLE_LABELS[stage.role as UserRole]?.[lang] ?? stage.role;
  const done = step?.status === "approved" || step?.status === "completed";

  const body = (() => {
    if (done) {
      return (
        <span className="text-slate-600">
          {/* A completed step with no name is possible in imported or seeded
              history. Say the stage is done rather than rendering a blank. */}
          {step!.actedByName || <span className="text-slate-400">{t("Completed", "مكتملة")}</span>}
          {step!.actedAs && step!.actedAs !== "primary" && (
            <span className="text-amber-700">
              {" · "}
              {t("on behalf of", "بالإنابة عن")}{" "}
              {ROLE_LABELS[(step!.actedForRole ?? stage.role) as UserRole]?.[lang] ?? step!.actedForRole}
            </span>
          )}
          {step!.actedAt && (
            <>
              <span className="text-slate-300 mx-1.5">·</span>
              <bdi className="text-slate-400">{formatDateTime(step!.actedAt)}</bdi>
            </>
          )}
        </span>
      );
    }
    if (step?.status === "skipped") {
      return <span className="text-slate-400">{t("Not reached", "لم يتم الوصول إليها")}</span>;
    }
    if (step?.status === "rejected") {
      return <span className="text-red-600">{t("Rejected here", "رُفضت هنا")}</span>;
    }
    return <span className="text-slate-400">{t("Waiting", "بالانتظار")}</span>;
  })();

  return (
    <div className={`text-sm flex items-baseline gap-2 flex-wrap ${indented ? "ps-1" : ""}`}>
      {indented && (
        <span className="text-xs text-slate-500 min-w-32">
          {done ? <Check size={11} className="inline text-emerald-600 me-1" /> : <Clock size={11} className="inline text-slate-300 me-1" />}
          {roleLabel}
        </span>
      )}
      {body}
      {step?.note && (
        <span className="w-full text-xs text-slate-500 italic flex items-start gap-1.5 mt-0.5">
          <PenLine size={11} className="mt-0.5 flex-shrink-0 text-slate-400" />
          {step.note}
        </span>
      )}
    </div>
  );
}

/** Ordered vs actual — the number the weighbridge exists to produce. */
function WeighSummary({ order, t }: { order: OrderRow; t: (en: string, ar: string) => string }) {
  const pct = order.variancePct ?? 0;
  // Half a percent is the mill's own tolerance; past it, somebody should look.
  const tone = Math.abs(pct) <= 0.5 ? "text-slate-600" : "text-amber-700 font-medium";
  return (
    <div className="mt-1.5 text-sm flex items-center gap-2 flex-wrap">
      <span className="text-slate-500">{t("Ordered", "المطلوب")}</span>
      <bdi className="tabular-nums text-slate-700">{(order.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}</bdi>
      <span className="text-slate-300">→</span>
      <span className="text-slate-500">{t("Actual", "الفعلي")}</span>
      <bdi className="tabular-nums font-medium text-slate-900">
        {((order.actualNetWeightKg ?? 0) / 1000).toFixed(3)} {t("t", "طن")}
      </bdi>
      <bdi className={`tabular-nums ${tone}`}>
        ({pct > 0 ? "+" : ""}{pct}%)
      </bdi>
    </div>
  );
}
