"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, ArrowLeft, Clock, FlaskConical, Inbox, PackageCheck,
  Scale, UserCheck, TrendingUp, TrendingDown, Minus, ListChecks, CheckCircle2, XCircle,
} from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { formatDate, formatDuration } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { agingTone } from "@/components/orders/cells";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";

export interface OrderLite {
  _id: string;
  orderNumber: string;
  customer?: string;
  customerAr?: string;
  totalWeightKg?: number;
  totalBags?: number;
  currentStageIndex?: number;
  currentStageEnteredAt?: string;
  labOverallStatus?: string;
  rejection?: { reason?: string; byName?: string; stageIndex?: number | null };
  updatedAt?: string;
}

type T = (en: string, ar: string) => string;

export function Card({
  title, icon, tone = "plain", action, children,
}: {
  title: string;
  icon?: React.ReactNode;
  tone?: "plain" | "alert";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // `h-full flex flex-col` + the content area's `flex-1` is what lets a
    // grid row of these actually equalize: the grid item stretches (parent
    // must use `items-stretch`, not `items-start`), and the card itself then
    // passes that stretched height down instead of shrinking to its content.
    <section
      className={
        "rounded-xl border shadow-sm h-full flex flex-col " +
        (tone === "alert" ? "bg-amber-50/60 border-amber-200" : "bg-white border-slate-200")
      }
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-medium text-slate-900 flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4 flex-1">{children}</div>
    </section>
  );
}

/**
 * The empty state carries information rather than apologising for an absent
 * list. On most days most people have nothing waiting, so this is the common
 * case, not the edge one (SPEC §10.0).
 */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 leading-relaxed">{children}</p>;
}

function More({ n, href, t }: { n: number; href: string; t: T }) {
  const router = useRouter();
  if (n <= 0) return null;
  return (
    <button
      onClick={() => router.push(href)}
      className="text-xs text-sky-700 hover:text-sky-900 cursor-pointer flex items-center gap-1 mt-2"
    >
      {t(`${n} more`, `${n} أخرى`)}
      <ArrowRight size={12} className="rtl:rotate-180" />
    </button>
  );
}

const tons = (kg: number | undefined, t: T) =>
  `${((kg ?? 0) / 1000).toFixed(3)} ${t("t", "طن")}`;

function stageName(index: number | undefined, lang: "en" | "ar") {
  const s = SALES_STAGES.find((x) => x.index === index);
  if (!s) return "—";
  return lang === "ar" ? s.groupAr ?? s.ar : s.groupEn ?? s.en;
}

/** One order line, used by nearly every block. */
function OrderLine({
  o, showStage = true, showAging = true,
}: { o: OrderLite; showStage?: boolean; showAging?: boolean }) {
  const { lang, t } = useLang();
  const router = useRouter();
  const now = useNow();

  const waited = now && o.currentStageEnteredAt
    ? formatDuration(now - new Date(o.currentStageEnteredAt).getTime(), lang)
    : "";
  const tone = now && o.currentStageEnteredAt ? agingTone(o.currentStageEnteredAt, now) : "calm";
  const toneClass = { calm: "text-slate-400", warn: "text-amber-600", late: "text-red-600 font-medium" }[tone];

  return (
    <button
      onClick={() => router.push(`/orders/${o._id}`)}
      className="w-full text-start flex items-baseline gap-3 py-2 hover:bg-slate-50 rounded-lg px-2 -mx-2 cursor-pointer"
    >
      <bdi className="font-mono text-xs text-sky-700 whitespace-nowrap">{o.orderNumber}</bdi>
      <span className="text-sm text-slate-700 truncate flex-1 min-w-0">
        {((lang === "ar" && o.customerAr) || o.customer) || "—"}
      </span>
      <bdi className="text-xs tabular-nums text-slate-500 whitespace-nowrap">{tons(o.totalWeightKg, t)}</bdi>
      {showStage && (
        <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:inline">
          {o.currentStageIndex}. {stageName(o.currentStageIndex, lang)}
        </span>
      )}
      {showAging && waited && (
        <span className={`text-xs inline-flex items-center gap-1 whitespace-nowrap ${toneClass}`}>
          <Clock size={10} />
          <bdi>{waited}</bdi>
        </span>
      )}
    </button>
  );
}

// ── Top stats row — the CMMS-style KPI strip ────────────────────────────────
const STAT_TONE = {
  red:   { border: "border-t-red-400",     iconBg: "bg-red-100 text-red-600" },
  amber: { border: "border-t-amber-400",   iconBg: "bg-amber-100 text-amber-600" },
  green: { border: "border-t-emerald-400", iconBg: "bg-emerald-100 text-emerald-600" },
  blue:  { border: "border-t-sky-400",     iconBg: "bg-sky-100 text-sky-600" },
} as const;

function StatTile({
  title, value, icon, tone, onClick,
}: {
  title: string; value: React.ReactNode; icon: React.ReactNode; tone: keyof typeof STAT_TONE;
  /** Present only on the one tile (overdue orders) that has somewhere to go. */
  onClick?: () => void;
}) {
  const cls = STAT_TONE[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={
        `w-full text-start rounded-xl border border-slate-200 border-t-4 ${cls.border} bg-white shadow-sm px-4 py-3.5 flex items-start justify-between gap-3 ` +
        (onClick ? "cursor-pointer hover:bg-slate-50 transition-colors" : "")
      }
    >
      <div className="min-w-0">
        <p className="text-sm text-slate-500 truncate">{title}</p>
        <bdi className="block text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</bdi>
      </div>
      <span className={`w-10 h-10 rounded-lg grid place-items-center flex-shrink-0 ${cls.iconBg}`}>{icon}</span>
    </Tag>
  );
}

/**
 * A quick-glance KPI strip above everything else, same idea as the CMMS
 * dashboard's own top row. Every number here is already computed elsewhere
 * on this same payload (`inChain`, `stuck`, `thisMonth`) — this is a second
 * READ of that data, not a second fetch. Tiles appear only when their
 * underlying block is in this role's list (`ROLE_BLOCKS`), so a role without
 * `thisMonth` simply gets a shorter row instead of a broken tile; `inChain`
 * is the one number every role always has, so the row is never empty for
 * anyone still in the chain.
 *
 * The overdue tile is clickable — it's the one place that number now lives
 * (the dashboard used to also show a dedicated "Overdue orders" card with the
 * same click-through; that card was dropped and this tile absorbed its
 * dialog, rather than the number existing in two places doing two different
 * things).
 */
const OVERDUE_PAGE_SIZE = 8;

export function StatsRow({
  inChain, stuck, thisMonth,
}: {
  inChain: number;
  stuck?: { rows: OrderLite[]; total: number; hours: number };
  thisMonth?: { current: { postedCount: number; rejectedCount: number } };
}) {
  const { lang, t } = useLang();
  const router = useRouter();
  const now = useNow();
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [overduePage, setOverduePage] = useState(0);
  const overduePageCount = stuck ? Math.max(1, Math.ceil(stuck.rows.length / OVERDUE_PAGE_SIZE)) : 1;
  const overdueShown = stuck
    ? stuck.rows.slice(overduePage * OVERDUE_PAGE_SIZE, (overduePage + 1) * OVERDUE_PAGE_SIZE)
    : [];

  const tiles: { key: string; title: string; value: number; icon: React.ReactNode; tone: keyof typeof STAT_TONE; onClick?: () => void }[] = [
    {
      key: "inChain", title: t("In pipeline", "قيد التنفيذ"), value: inChain,
      icon: <ListChecks size={18} />, tone: "blue",
    },
  ];
  if (stuck) {
    tiles.unshift({
      key: "stuck", title: t("Overdue orders", "الطلبيات المتأخرة"), value: stuck.total,
      icon: <AlertTriangle size={18} />, tone: "red",
      onClick: stuck.total ? () => { setOverduePage(0); setOverdueOpen(true); } : undefined,
    });
  }
  if (thisMonth) {
    tiles.push(
      {
        key: "posted", title: t("Posted this month", "مرحّلة هذا الشهر"), value: thisMonth.current.postedCount,
        icon: <CheckCircle2 size={18} />, tone: "green",
      },
      {
        key: "rejected", title: t("Rejected this month", "مرفوضة هذا الشهر"), value: thisMonth.current.rejectedCount,
        icon: <XCircle size={18} />, tone: "amber",
      }
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((s) => (
          <StatTile key={s.key} title={s.title} value={s.value} icon={s.icon} tone={s.tone} onClick={s.onClick} />
        ))}
      </div>

      {stuck && (
        <Dialog open={overdueOpen} onOpenChange={setOverdueOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" />
                {t("Overdue orders", "الطلبيات المتأخرة")}
              </DialogTitle>
            </DialogHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-start font-medium py-2">{t("Order", "الطلبية")}</th>
                    <th className="text-start font-medium py-2">{t("Customer", "الزبون")}</th>
                    <th className="text-end font-medium py-2 px-2">{t("Weight", "الوزن")}</th>
                    <th className="text-start font-medium py-2 px-2 hidden sm:table-cell">{t("Stage", "المرحلة")}</th>
                    <th className="text-start font-medium py-2 px-2 hidden sm:table-cell">{t("Responsible", "المسؤول")}</th>
                    <th className="text-end font-medium py-2">{t("Waiting", "منتظرة منذ")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overdueShown.map((o) => {
                    const waited = now && o.currentStageEnteredAt
                      ? formatDuration(now - new Date(o.currentStageEnteredAt).getTime(), lang)
                      : "";
                    const tone = now && o.currentStageEnteredAt ? agingTone(o.currentStageEnteredAt, now) : "calm";
                    const toneClass = { calm: "text-slate-500", warn: "text-amber-600", late: "text-red-600 font-medium" }[tone];
                    return (
                      <tr
                        key={o._id}
                        onClick={() => router.push(`/orders/${o._id}`)}
                        className="cursor-pointer hover:bg-slate-50"
                      >
                        <td className="py-2"><bdi className="font-mono text-xs text-sky-700 whitespace-nowrap">{o.orderNumber}</bdi></td>
                        <td className="py-2 text-slate-700 max-w-32 truncate">
                          {((lang === "ar" && o.customerAr) || o.customer) || "—"}
                        </td>
                        <td className="py-2 px-2 text-end"><bdi className="tabular-nums text-slate-600 whitespace-nowrap">{tons(o.totalWeightKg, t)}</bdi></td>
                        <td className="py-2 px-2 text-slate-600 whitespace-nowrap hidden sm:table-cell">
                          {o.currentStageIndex}. {stageName(o.currentStageIndex, lang)}
                        </td>
                        <td className="py-2 px-2 text-slate-600 whitespace-nowrap hidden sm:table-cell">
                          {ROLE_LABELS[(SALES_STAGES.find((s) => s.index === o.currentStageIndex)?.role ?? "") as UserRole]?.[lang] ?? ""}
                        </td>
                        <td className={`py-2 text-end whitespace-nowrap ${toneClass}`}><bdi>{waited}</bdi></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {overduePageCount > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  onClick={() => setOverduePage((p) => Math.max(0, p - 1))}
                  disabled={overduePage === 0}
                  className="w-7 h-7 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  {lang === "ar" ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
                </button>
                <span className="text-xs text-slate-400 tabular-nums">
                  {t(`Page ${overduePage + 1} of ${overduePageCount}`, `صفحة ${overduePage + 1} من ${overduePageCount}`)}
                </span>
                <button
                  onClick={() => setOverduePage((p) => Math.min(overduePageCount - 1, p + 1))}
                  disabled={overduePage >= overduePageCount - 1}
                  className="w-7 h-7 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  {lang === "ar" ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
                </button>
              </div>
            )}

            <More n={stuck.total - stuck.rows.length} href="/orders" t={t} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── A · Waiting on me ──────────────────────────────────────────────────────
export function WaitingOnMe({
  data, inChain,
}: { data: { rows: OrderLite[]; total: number }; inChain: number }) {
  const { t } = useLang();
  return (
    <Card title={t("Waiting on you", "في انتظارك")} icon={<Inbox size={16} className="text-sky-600" />}>
      {data.rows.length ? (
        <>
          <div className="divide-y divide-slate-100">
            {data.rows.map((o) => <OrderLine key={o._id} o={o} />)}
          </div>
          <More n={data.total - data.rows.length} href="/approvals" t={t} />
        </>
      ) : (
        <Empty>
          {t("Nothing is waiting on you.", "لا يوجد شيء في انتظارك.")}{" "}
          {inChain > 0
            ? t(`${inChain} order(s) are moving through the chain.`, `هناك ${inChain} طلبية تسير في السلسلة.`)
            : t("The chain is empty.", "السلسلة فارغة.")}
        </Empty>
      )}
    </Card>
  );
}

// ── B · My orders ──────────────────────────────────────────────────────────
export function MyOrders({ data }: { data: { live: OrderLite[]; rejected: OrderLite[] } }) {
  const { lang, t } = useLang();
  return (
    <Card title={t("Orders you raised", "الطلبيات التي أنشأتها")} icon={<PackageCheck size={16} className="text-slate-500" />}>
      {data.live.length ? (
        <div className="divide-y divide-slate-100">
          {data.live.map((o) => <OrderLine key={o._id} o={o} />)}
        </div>
      ) : (
        <Empty>{t("None of your orders are still moving.", "لا توجد طلبيات لك ما زالت قيد التقدّم.")}</Empty>
      )}

      {/* The coordinator is the one the customer telephones, so a rejection he
          has not seen yet is the most expensive thing on this screen. */}
      {data.rejected.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-1.5">
            {t("Rejected in the last 30 days", "مرفوضة بآخر ٣٠ يوم")}
          </p>
          <ul className="space-y-1.5">
            {data.rejected.map((o) => (
              <li key={o._id} className="text-sm">
                <bdi className="font-mono text-xs text-red-700">{o.orderNumber}</bdi>{" "}
                <span className="text-slate-600">{((lang === "ar" && o.customerAr) || o.customer) || ""}</span>
                {o.rejection?.reason && (
                  <span className="block text-xs text-slate-500">
                    {stageName(o.rejection.stageIndex ?? undefined, lang)} — {o.rejection.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}


// ── E · This month ─────────────────────────────────────────────────────────
interface Period {
  postedCount: number; postedKg: number; avgHours: number | null;
  rejectedCount: number; rejectedKg: number;
}

/**
 * Change against last month.
 *
 * The ARROW follows the number and the COLOUR follows whether that is good —
 * two separate questions. Folding them together by negating the inputs (the
 * first attempt) drew a falling arrow beside a rising rejection count, which
 * says the opposite of what happened.
 */
function Delta({
  now, before, higherIsBetter = true,
}: { now: number; before: number; higherIsBetter?: boolean }) {
  const { t } = useLang();
  if (before === 0 && now === 0) return null;

  const diff = now - before;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const better = higherIsBetter ? diff > 0 : diff < 0;
  const tone = diff === 0 ? "text-slate-400" : better ? "text-emerald-600" : "text-red-600";
  const pct = before === 0 ? null : Math.round((diff / before) * 100);

  return (
    <span
      className={`text-xs inline-flex items-center gap-0.5 ${tone}`}
      // "نفس عدد الأيام", not "الشهر الماضي" — the comparison is against the
      // SAME NUMBER of elapsed days last month, never the whole of it. Saying
      // so on the number itself is what stops "-74%" reading as a verdict
      // instead of a pace: 7 days in vs 7 days last month is a fair fight,
      // 7 days vs all 30 of them is not.
      title={t("vs the same number of days last month", "مقارنة بنفس عدد الأيام من الشهر الماضي")}
    >
      <Icon size={12} />
      <bdi>{pct === null ? t("new", "جديد") : `${Math.abs(pct)}%`}</bdi>
    </span>
  );
}

export function ThisMonth({ data }: { data: { current: Period; previous: Period } }) {
  const { t } = useLang();
  const c = data.current, p = data.previous;
  const hrs = (h: number | null) =>
    h === null ? "—" : h >= 48 ? `${Math.round(h / 24)} ${t("d", "ي")}` : `${Math.round(h)} ${t("h", "س")}`;

  const cells = [
    { label: t("Posted", "مرحّلة"), value: c.postedCount, delta: <Delta now={c.postedCount} before={p.postedCount} /> },
    { label: t("Tons posted", "الأطنان المرحّلة"), value: (c.postedKg / 1000).toFixed(1), delta: <Delta now={c.postedKg} before={p.postedKg} /> },
    { label: t("Rejected", "مرفوضة"), value: c.rejectedCount, delta: <Delta now={c.rejectedCount} before={p.rejectedCount} higherIsBetter={false} /> },
    { label: t("Order to posted", "من الإنشاء إلى الترحيل"), value: hrs(c.avgHours), delta: null },
  ];

  return (
    <Card title={t("This month", "هذا الشهر")} icon={<TrendingUp size={16} className="text-slate-500" />}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cells.map((cell, i) => (
          <div key={i}>
            <p className="text-xs text-slate-500">{cell.label}</p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums flex items-baseline gap-1.5">
              <bdi>{cell.value}</bdi>
              {cell.delta}
            </p>
          </div>
        ))}
      </div>
      {c.rejectedKg > 0 && (
        <p className="text-xs text-slate-500 mt-3">
          {t("Tons lost to rejection", "أطنان مفقودة بسبب الرفض")}:{" "}
          <bdi className="tabular-nums text-red-700">{(c.rejectedKg / 1000).toFixed(1)}</bdi>
        </p>
      )}
      {/* The one line that makes the percentages legible without a hover:
          month-to-date vs the SAME number of days last month, never the
          whole of it — otherwise day 7 of a 30-day month reads as "-74%"
          and gets mistaken for a verdict instead of a pace. */}
      <p className="text-xs text-slate-400 mt-3">
        {t(
          "Percentages compare the same number of elapsed days last month, not the full month.",
          "النسب مقارنة بنفس عدد الأيام المنقضية من الشهر الماضي، لا الشهر كاملاً."
        )}
      </p>
    </Card>
  );
}

/**
 * Same four numbers as `ThisMonth`, stacked in one narrow column instead of a
 * 4-up grid — for the 20% slot beside the quality/product-mix charts, where a
 * horizontal grid would be squeezed into unreadable widths.
 */
export function ThisMonthCompact({ data }: { data: { current: Period; previous: Period } }) {
  const { t } = useLang();
  const c = data.current, p = data.previous;
  const hrs = (h: number | null) =>
    h === null ? "—" : h >= 48 ? `${Math.round(h / 24)} ${t("d", "ي")}` : `${Math.round(h)} ${t("h", "س")}`;

  const cells = [
    { label: t("Posted", "مرحّلة"), value: c.postedCount, delta: <Delta now={c.postedCount} before={p.postedCount} /> },
    { label: t("Tons posted", "الأطنان المرحّلة"), value: (c.postedKg / 1000).toFixed(1), delta: <Delta now={c.postedKg} before={p.postedKg} /> },
    { label: t("Rejected", "مرفوضة"), value: c.rejectedCount, delta: <Delta now={c.rejectedCount} before={p.rejectedCount} higherIsBetter={false} /> },
    { label: t("Order to posted", "من الإنشاء إلى الترحيل"), value: hrs(c.avgHours), delta: null },
  ];

  return (
    <Card title={t("This month", "هذا الشهر")} icon={<TrendingUp size={16} className="text-slate-500" />}>
      <div className="flex flex-col divide-y divide-slate-100">
        {cells.map((cell, i) => (
          <div key={i} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-xs text-slate-500">{cell.label}</p>
            <p className="text-xl font-semibold text-slate-900 tabular-nums flex items-baseline gap-1.5">
              <bdi>{cell.value}</bdi>
              {cell.delta}
            </p>
          </div>
        ))}
      </div>
      {/* Shorter than ThisMonth's own wording — this card sits in a narrow
          column, and the full sentence wraps to three lines there. */}
      <p className="text-xs text-slate-400 mt-2">
        {t(
          "vs. the same number of days last month",
          "مقارنة بنفس عدد الأيام من الشهر الماضي"
        )}
      </p>
    </Card>
  );
}

// ── G · Lab queue ──────────────────────────────────────────────────────────
export function LabQueue({
  data,
}: {
  data: {
    awaiting: OrderLite[];
    today: { _id: string; sampleNumber: string; product: string; overallStatus: string; orderNumber?: string }[];
    fails: number;
  };
}) {
  const { t } = useLang();
  return (
    <Card title={t("Lab queue", "طابور المختبر")} icon={<FlaskConical size={16} className="text-cyan-600" />}>
      {data.awaiting.length ? (
        <div className="divide-y divide-slate-100">
          {data.awaiting.map((o) => <OrderLine key={o._id} o={o} showStage={false} />)}
        </div>
      ) : (
        <Empty>{t("No orders are awaiting results.", "لا توجد طلبيات تنتظر النتائج.")}</Empty>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-500 mb-1.5">
          {t("Samples recorded today", "عيّنات اليوم")}
          {data.fails > 0 && (
            <span className="text-red-700 font-medium">
              {" · "}
              {t(`${data.fails} out of range`, `${data.fails} خارج النطاق`)}
            </span>
          )}
        </p>
        {data.today.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {data.today.map((s) => (
              <li key={s._id} className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1">
                <bdi className="font-mono text-[11px] text-slate-500">{s.sampleNumber}</bdi>
                <QcStatusBadge status={s.overallStatus} size="xs" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">{t("None yet today.", "ولا واحدة اليوم.")}</p>
        )}
      </div>
    </Card>
  );
}

// ── H · Quality signal ─────────────────────────────────────────────────────
export function Quality({
  data,
}: { data: { pass: number; warning: number; fail: number; total: number; inSpecPct: number | null; days: number } }) {
  const { t } = useLang();
  if (!data.total) {
    return (
      <Card title={t("Quality", "الجودة")} icon={<FlaskConical size={16} className="text-slate-500" />}>
        <Empty>{t(`No samples in the last ${data.days} days.`, `لا توجد عيّنات خلال آخر ${data.days} يوم.`)}</Empty>
      </Card>
    );
  }

  /* The validated palette (SPEC §11.1). Do not substitute by eye: the obvious
     Tailwind green/amber/red fails the colour-blindness floor. Amber sits at
     2.09:1 on this surface, so it always carries a visible number. */
  const parts = [
    { key: "pass",    n: data.pass,    color: "var(--chart-pass)",    label: t("In spec", "مطابق") },
    { key: "warning", n: data.warning, color: "var(--chart-warning)", label: t("Near limit", "قريب من الحد") },
    { key: "fail",    n: data.fail,    color: "var(--chart-fail)",    label: t("Out of range", "خارج النطاق") },
  ];

  return (
    <Card title={t("Quality", "الجودة")} icon={<FlaskConical size={16} className="text-slate-500" />}>
      <div className="flex items-baseline gap-2 mb-3">
        <bdi className="text-3xl font-semibold text-slate-900 tabular-nums">{data.inSpecPct}%</bdi>
        <span className="text-sm text-slate-500">
          {t(`in spec · last ${data.days} days`, `مطابق · آخر ${data.days} يوم`)}
        </span>
      </div>

      <div className="flex h-3 rounded-full overflow-hidden mb-2">
        {parts.map((p) => (p.n ? <span key={p.key} style={{ width: `${(p.n / data.total) * 100}%`, background: p.color }} /> : null))}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li key={p.key} className="text-xs text-slate-600 inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}
            <bdi className="tabular-nums font-medium text-slate-900">{p.n}</bdi>
          </li>
        ))}
      </ul>

      {/* The bar reads as three colours with no explanation otherwise — this is
          what each one means and what the number is counted over. */}
      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
        {t(
          "Every lab sample recorded plant-wide in the period, not only samples linked to an order. Warnings count as in spec — they are inside the accepted range, just close to a limit.",
          "كل عيّنة مختبر مسجَّلة على مستوى المصنع خلال هذه الفترة، وليس العيّنات المرتبطة بطلبية فقط. التحذيرات محسوبة ضمن المطابق — فهي داخل النطاق المقبول، لكنها قريبة من الحد."
        )}
      </p>
    </Card>
  );
}

// ── I · Ready to weigh ─────────────────────────────────────────────────────
export function ReadyToWeigh({
  data,
}: { data: { rows: OrderLite[]; total: number; awaitingSignoff: number } }) {
  const { lang, t } = useLang();
  const router = useRouter();
  return (
    <Card title={t("Ready to weigh", "جاهزة للوزن")} icon={<Scale size={16} className="text-orange-600" />}>
      {data.rows.length ? (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((o) => (
            <li
              key={o._id}
              onClick={() => router.push(`/orders/${o._id}`)}
              className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded px-2 -mx-2"
            >
              <bdi className="font-mono text-xs text-sky-700 whitespace-nowrap">{o.orderNumber}</bdi>
              <span className="text-sm text-slate-700 truncate flex-1">
                {((lang === "ar" && o.customerAr) || o.customer) || "—"}
              </span>
              {o.labOverallStatus && <QcStatusBadge status={o.labOverallStatus} size="xs" />}
              <bdi className="text-sm tabular-nums text-slate-900 font-medium whitespace-nowrap">
                {tons(o.totalWeightKg, t)}
              </bdi>
              <bdi className="text-xs text-slate-400 tabular-nums whitespace-nowrap hidden sm:block">
                {/* Bulk loads have no sacks — the tonnage beside this is their
                    whole quantity, so "0 كيس" would be noise. */}
                {o.totalBags ? `${o.totalBags} ${t("bags", "كيس")}` : t("bulk", "صبّ")}
              </bdi>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {t("Nothing is ready to weigh.", "لا يوجد شيء جاهز للوزن.")}{" "}
          {/*
            SPEC §10.0 wanted this to read "2 orders are awaiting sign-off", but
            that count comes through `visibilityFilter` and the weighbridge's
            floor is stage 8 — so for them it is always 0, and computing it
            without the filter would tell them orders exist that they are not
            allowed to know about. Rule 1 wins over the sample copy: the
            sentence explains how the queue fills instead of counting what they
            may not see. Admins, who see everything, still get the number.
          */}
          {data.awaitingSignoff > 0
            ? t(
                `${data.awaitingSignoff} order(s) are awaiting sign-off.`,
                `هناك ${data.awaitingSignoff} طلبية تنتظر الاعتماد.`
              )
            : t(
                "Orders appear here once both managers have signed.",
                "تظهر الطلبيات هنا بعد توقيع المديرَين."
              )}
        </Empty>
      )}
      <More n={data.total - data.rows.length} href="/orders?stage=8" t={t} />
    </Card>
  );
}

// ── J · Coverage ───────────────────────────────────────────────────────────
export function Coverage({
  data,
}: {
  data: {
    away: boolean;
    absentTo: string | null;
    givingOut: { _id: string; role: string; toUserName: string; to: string }[];
    holding: { _id: string; role: string; to: string }[];
    coveredBy: { role: string; names: string[] }[];
  };
}) {
  const { lang, t } = useLang();
  const label = (r: string) => ROLE_LABELS[r as UserRole]?.[lang] ?? r;

  // Nothing in force: render nothing. A strip that always says "no delegations"
  // is noise on 360 days of the year.
  if (!data.away && !data.givingOut.length && !data.holding.length) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 space-y-1.5">
      <p className="text-sm font-medium text-amber-900 flex items-center gap-2">
        <UserCheck size={15} />
        {t("In force for you right now", "ساري عليك الآن")}
      </p>

      {data.away && (
        <p className="text-sm text-amber-800">
          {t("You are marked away", "أنت مسجَّل غائباً")}
          {data.absentTo && <> {t("until", "لحد")} <bdi>{formatDate(data.absentTo)}</bdi></>}
          {data.coveredBy.some((c) => c.names.length) && (
            <>
              {" · "}
              {data.coveredBy
                .filter((c) => c.names.length)
                .map((c) => t(`${label(c.role)} is covering`, `${label(c.role)} ينوب عنك`))
                .join(" · ")}
            </>
          )}
        </p>
      )}

      {data.holding.map((d) => (
        <p key={d._id} className="text-sm text-amber-800">
          {t(`You are covering the ${label(d.role)}`, `أنت تنوب عن ${label(d.role)}`)}{" "}
          {t("until", "لحد")} <bdi>{formatDate(d.to)}</bdi>
        </p>
      ))}

      {data.givingOut.map((d) => (
        <p key={d._id} className="text-sm text-amber-800">
          {t(`${d.toUserName} is covering your ${label(d.role)} duties`, `${d.toUserName} ينوب عنك في دور ${label(d.role)}`)}{" "}
          {t("until", "لحد")} <bdi>{formatDate(d.to)}</bdi>
        </p>
      ))}
    </div>
  );
}
