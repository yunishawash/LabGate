"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, ArrowLeft, Clock, FlaskConical, Inbox, PackageCheck,
  Scale, UserCheck, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { formatDate, formatDuration } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { agingTone } from "@/components/orders/cells";
import { LATE_HOURS, LATE_MS } from "@/lib/aging";
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
            : t("The chain is empty.", "السلسلة فاضية.")}
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

// ── C · Pipeline board ─────────────────────────────────────────────────────
export function Pipeline({
  data,
}: { data: { index: number; count: number; kg: number; oldest: string | null }[] }) {
  const { lang, t } = useLang();
  const router = useRouter();
  const now = useNow();
  const peak = Math.max(1, ...data.map((d) => d.count));

  return (
    <Card title={t("The whole chain", "السلسلة كاملة")} icon={<ArrowRight size={16} className="text-slate-500 rtl:rotate-180" />}>
      {/* Plain HTML bars, not a chart library. Recharts' category axis does not
          reserve its gutter when mirrored, so Arabic labels drew over the bars;
          this mirrors natively and renders Arabic in the page font. */}
      <div className="space-y-1.5">
        {data.map((d) => {
          const late = d.oldest && now ? now - new Date(d.oldest).getTime() > LATE_MS : false;
          return (
            <button
              key={d.index}
              disabled={d.count === 0}
              onClick={() => router.push(`/orders?stage=${d.index}`)}
              className={
                "w-full flex items-center gap-2 text-start rounded-lg px-1.5 py-1 " +
                (d.count === 0 ? "cursor-default" : "cursor-pointer hover:bg-slate-50")
              }
            >
              <span className="font-mono text-[10px] text-slate-400 w-3">{d.index}</span>
              <span className={"text-xs w-32 truncate " + (d.count ? "text-slate-700" : "text-slate-300")}>
                {stageName(d.index, lang)}
              </span>
              <span className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden min-w-8">
                <span
                  className={"block h-full rounded-sm " + (late ? "bg-red-500" : "bg-sky-500")}
                  style={{ width: `${(d.count / peak) * 100}%` }}
                />
              </span>
              <bdi className={"text-xs tabular-nums w-6 text-end " + (d.count ? "text-slate-900 font-medium" : "text-slate-300")}>
                {d.count}
              </bdi>
              <bdi className="text-[11px] tabular-nums text-slate-400 w-20 text-end hidden sm:block">
                {d.count ? tons(d.kg, t) : ""}
              </bdi>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-400 mt-2">
        {t(
          `Red means something there has waited over ${LATE_HOURS} hours.`,
          `الأحمر يعني أنّ شيئاً هناك انتظر أكثر من ${LATE_HOURS} ساعة.`
        )}
      </p>
    </Card>
  );
}

// ── D · Overdue orders ──────────────────────────────────────────────────────
const STUCK_PAGE_SIZE = 5;

/**
 * A real paginated list, not a full-width banner — it lives as one column in
 * a fixed three-up row (with Pipeline and Volume trend), so it always renders
 * something in that slot rather than disappearing when nothing is overdue.
 * Pagination is client-side over the rows the API already fetched (capped
 * server-side — see `dashboard/route.ts`); a residual note covers the rare
 * case where the true total exceeds that cap.
 */
export function Stuck({ data }: { data: { rows: OrderLite[]; total: number; hours: number } }) {
  const { lang, t } = useLang();
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(data.rows.length / STUCK_PAGE_SIZE));
  const shown = data.rows.slice(page * STUCK_PAGE_SIZE, (page + 1) * STUCK_PAGE_SIZE);
  const days = data.hours / 24;

  return (
    <Card
      title={t("Overdue orders", "الطلبيات المتأخرة")}
      icon={<AlertTriangle size={16} className="text-amber-600" />}
    >
      {!data.total ? (
        <Empty>
          {t(
            `Nothing has waited more than ${days} day(s).`,
            `لا توجد طلبية انتظرت أكثر من ${days} يوم.`
          )}
        </Empty>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">
            {t(
              `${data.total} order(s) waiting more than ${days} day(s)`,
              `${data.total} طلبية منتظرة منذ أكثر من ${days} يوم`
            )}
          </p>
          <div className="divide-y divide-slate-100">
            {shown.map((o) => (
              <div key={o._id} className="py-1.5">
                <OrderLine o={o} />
                <p className="text-xs text-amber-800 px-2">
                  {t("On", "عند")}{" "}
                  {ROLE_LABELS[(SALES_STAGES.find((s) => s.index === o.currentStageIndex)?.role ?? "") as UserRole]?.[lang] ?? ""}
                </p>
              </div>
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="w-7 h-7 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {lang === "ar" ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
              </button>
              <span className="text-xs text-slate-400 tabular-nums">
                {t(`Page ${page + 1} of ${pageCount}`, `صفحة ${page + 1} من ${pageCount}`)}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="w-7 h-7 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {lang === "ar" ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
              </button>
            </div>
          )}

          <More n={data.total - data.rows.length} href="/orders" t={t} />
        </>
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
    <span className={`text-xs inline-flex items-center gap-0.5 ${tone}`} title={t("vs last month", "مقارنة بالشهر الماضي")}>
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
                {o.totalBags} {t("bags", "كيس")}
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
