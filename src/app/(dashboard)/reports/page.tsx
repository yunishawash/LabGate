"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BarChart3, Download } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { formatDate } from "@/lib/utils";
import { SALES_STAGES } from "@/lib/salesWorkflow";

/**
 * Hours, told at the scale a person would use.
 *
 * The first version printed "0 h" for every row because most signatures land in
 * minutes — a table of zeros that looked broken and hid the one desk that took
 * a day and a half.
 */
function useHours() {
  const { t } = useLang();
  return (h: number | null) => {
    if (h === null) return null;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} ${t("min", "د")}`;
    if (h < 48) return `${Math.round(h * 10) / 10} ${t("h", "س")}`;
    return `${Math.round(h / 24)} ${t("d", "ي")}`;
  };
}

type ReportKey = "cycleTime" | "rejections" | "variance" | "customers" | "coverage" | "weightTrend";

const TABS: { key: ReportKey; en: string; ar: string; question: [string, string] }[] = [
  { key: "cycleTime",  en: "Cycle time",  ar: "زمن الدورة",
    question: ["Which desk holds orders the longest?", "أي مكتب يحتجز الطلبيات أطول مدّة؟"] },
  { key: "rejections", en: "Rejections",  ar: "الرفض",
    question: ["Why do orders die, and where?", "لماذا تتوقّف الطلبيات، وأين؟"] },
  { key: "variance",   en: "Weight variance", ar: "فروقات الوزن",
    question: ["Are we shipping what we sold?", "هل نشحن ما بعناه فعلاً؟"] },
  { key: "weightTrend", en: "Ordered vs weighed", ar: "المطلوب مقابل الموزون",
    question: ["Ordered vs weighed, month by month", "المطلوب مقابل الموزون، شهرًا بشهر"] },
  { key: "customers",  en: "Customers",   ar: "الزبائن",
    question: ["Who are our real customers?", "من هم زبائننا الحقيقيون؟"] },
  { key: "coverage",   en: "Coverage",    ar: "التغطية",
    question: ["How often is a desk signed by somebody else?", "كم مرّة يوقّع شخص غير صاحب المكتب؟"] },
];

const EXPORTS: { type: string; en: string; ar: string }[] = [
  { type: "orders",    en: "Orders",     ar: "الطلبيات" },
  { type: "pipeline",  en: "Pipeline",   ar: "خط السير" },
  { type: "cycleTime", en: "Cycle time", ar: "زمن الدورة" },
];

export default function ReportsPage() {
  const { lang, t } = useLang();
  const [tab, setTab] = useState<ReportKey>("cycleTime");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Record<string, never> | null>(null);
  const [loading, setLoading] = useState(true);

  // Only the "Ordered vs weighed" tab uses these — fetched once, on demand,
  // the same lazy pattern the order dialog's own customer picker uses.
  const [trendCustomerId, setTrendCustomerId] = useState("");
  const [trendProductId, setTrendProductId] = useState("");
  const [customers, setCustomers] = useState<{ _id: string; name: string; nameAr?: string }[]>([]);
  const [products, setProducts] = useState<{ _id: string; name: string; nameAr?: string }[]>([]);

  useEffect(() => {
    if (tab !== "weightTrend" || customers.length || products.length) return;
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
  }, [tab, customers.length, products.length]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ report: tab });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (tab === "weightTrend") {
      if (trendCustomerId) p.set("customerId", trendCustomerId);
      if (trendProductId) p.set("productId", trendProductId);
    }
    try {
      const res = await fetch(`/api/reports?${p}`);
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [tab, from, to, trendCustomerId, trendProductId]);

  useEffect(() => { load(); }, [load]);

  const stageName = (i: number | null | undefined) => {
    const s = SALES_STAGES.find((x) => x.index === i);
    if (!s) return "—";
    return lang === "ar" ? s.groupAr ?? s.ar : s.groupEn ?? s.en;
  };

  const download = (type: string) => {
    const p = new URLSearchParams({ type, lang });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    // `assign()` rather than assigning to `location.href`: React Compiler
    // rejects writing to a global, and the response is Content-Disposition:
    // attachment, so the browser downloads it without leaving the page.
    window.location.assign(`/api/export?${p}`);
  };

  const active = TABS.find((x) => x.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 size={22} className="text-slate-500" />
            {t("Reports", "التقارير")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{active.question[lang === "ar" ? 1 : 0]}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {EXPORTS.map((e) => (
            <Button key={e.type} variant="outline" size="sm" className="gap-1.5" onClick={() => download(e.type)}>
              <Download size={14} />
              {lang === "ar" ? e.ar : e.en}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border-b border-slate-200 flex-wrap">
          {TABS.map((x) => (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={
                "px-3 py-2 text-sm border-b-2 -mb-px cursor-pointer transition-colors " +
                (tab === x.key
                  ? "border-sky-500 text-sky-700 font-medium"
                  : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              {lang === "ar" ? x.ar : x.en}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ms-auto">
          {tab === "weightTrend" && (
            <>
              <Select value={trendCustomerId || "__all__"} onValueChange={(v) => setTrendCustomerId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("All customers", "كل الزبائن")}</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c._id} value={c._id}>{(lang === "ar" && c.nameAr) || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={trendProductId || "__all__"} onValueChange={(v) => setTrendProductId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("All products", "كل الأصناف")}</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p._id} value={p._id}>{(lang === "ar" && p.nameAr) || p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <DateRangePicker from={from} to={to} onChange={(f, toVal) => { setFrom(f); setTo(toVal); }} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        {loading && <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !data && (
          <p className="text-sm text-red-600">{t("Could not load this report.", "تعذّر تحميل التقرير.")}</p>
        )}

        {!loading && data && tab === "cycleTime" && <CycleTime data={data} stageName={stageName} />}
        {!loading && data && tab === "rejections" && <RejectionReport data={data} stageName={stageName} />}
        {!loading && data && tab === "variance" && <VarianceReport data={data} />}
        {!loading && data && tab === "weightTrend" && (
          <WeightTrendReport data={data} customerId={trendCustomerId} productId={trendProductId} />
        )}
        {!loading && data && tab === "customers" && <CustomerReport data={data} />}
        {!loading && data && tab === "coverage" && <CoverageReport data={data} stageName={stageName} />}
      </div>
    </div>
  );
}

// ── shared table shell ─────────────────────────────────────────────────────
function Table({ headers, children }: { headers: (string | null)[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-500 border-b border-slate-200">
          {headers.map((h, i) => (
            <th key={i} className={"font-medium py-2 whitespace-nowrap " + (i === 0 ? "text-start" : "text-end px-3")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  );
}

const Num = ({ v, cls = "" }: { v: number | string | null; cls?: string }) => (
  <td className={`py-2 px-3 text-end tabular-nums whitespace-nowrap ${cls}`}>
    <bdi>{v ?? "—"}</bdi>
  </td>
);

function Bar({ value, peak, tone = "sky" }: { value: number; peak: number; tone?: "sky" | "red" | "amber" }) {
  const bg = { sky: "bg-sky-500", red: "bg-red-500", amber: "bg-amber-500" }[tone];
  return (
    <span className="inline-block w-24 h-2.5 bg-slate-100 rounded-sm overflow-hidden align-middle">
      <span className={`block h-full ${bg} rounded-sm`} style={{ width: `${Math.min(100, (value / peak) * 100)}%` }} />
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 py-3">{children}</p>;
}

export interface VarianceOrderRow {
  _id: string; orderNumber: string; customer: string; customerAr?: string;
  totalWeightKg: number; actualNetWeightKg: number; variancePct: number; postedAt: string;
}

/** The order list under a report — used both by the variance report's own
 *  outliers and by the weight-trend chart's per-point drill-down, which
 *  reuses this exact shape and columns rather than inventing a second one. */
function OrdersTable({ title, orders }: { title: string; orders: VarianceOrderRow[] }) {
  const { lang, t } = useLang();
  if (!orders.length) return null;
  return (
    <>
      <h3 className="text-sm font-medium text-slate-900 mt-5 mb-2">{title}</h3>
      <Table headers={[t("Order", "الطلبية"), t("Ordered", "المطلوب"), t("Actual", "الفعلي"), t("Variance", "الفرق"), t("Posted", "الترحيل")]}>
        {orders.slice(0, 15).map((o) => (
          <tr key={o._id}>
            <td className="py-2">
              <Link href={`/orders/${o._id}`} className="font-mono text-xs text-sky-700 hover:underline">
                <bdi>{o.orderNumber}</bdi>
              </Link>
              <span className="text-slate-600 ms-2">{(lang === "ar" && o.customerAr) || o.customer}</span>
            </td>
            <Num v={(o.totalWeightKg / 1000).toFixed(3)} />
            <Num v={(o.actualNetWeightKg / 1000).toFixed(3)} />
            <Num v={`${o.variancePct > 0 ? "+" : ""}${o.variancePct}%`} cls="text-amber-700 font-medium" />
            <Num v={formatDate(o.postedAt)} cls="text-slate-400" />
          </tr>
        ))}
      </Table>
    </>
  );
}

// ── cycle time ─────────────────────────────────────────────────────────────
function CycleTime({ data }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { lang, t } = useLang();
  const hours = useHours();
  /**
   * Named by STEP here, not by stage: a dual-slot stage (an index held by more
   * than one signature — none currently exists) would otherwise show two rows
   * under the same group name, and this table measures each one separately.
   */
  const stepName = (key: string) => {
    const s = SALES_STAGES.find((x) => x.key === key);
    return s ? (lang === "ar" ? s.ar : s.en) : key;
  };
  const rows = (data.byStage ?? []) as unknown as {
    stageKey: string; stageIndex: number; n: number;
    avgHours: number | null; p90Hours: number | null; maxHours: number | null;
    people: { name: string; n: number; avgHours: number | null }[];
  }[];
  if (!rows.length) return <Empty>{t("No completed steps in this period.", "لا توجد خطوات مكتملة في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...rows.map((r) => r.avgHours ?? 0));

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Signed", "توقيعات"), t("Average", "المتوسط"), null, t("p90", "الشريحة ٩٠"), t("Longest", "الأطول")]}>
        {rows.map((r) => (
          <tr key={r.stageKey}>
            <td className="py-2 text-slate-800">
              <span className="font-mono text-xs text-slate-400 me-1.5">{r.stageIndex}</span>
              {stepName(r.stageKey)}
              {r.people.length > 1 && (
                <span className="block text-xs text-slate-400">
                  {r.people.map((p) => `${p.name} (${hours(p.avgHours)})`).join(" · ")}
                </span>
              )}
            </td>
            <Num v={r.n} />
            <Num v={hours(r.avgHours)} cls="text-slate-900 font-medium" />
            <td className="py-2 px-3 text-end"><Bar value={r.avgHours ?? 0} peak={peak} /></td>
            {/* p90 is the honest headline: an average hides the one order that
                sat for three days behind nine that moved in an hour. */}
            <Num v={hours(r.p90Hours)} />
            <Num v={hours(r.maxHours)} cls="text-slate-400" />
          </tr>
        ))}
      </Table>
      <p className="text-xs text-slate-400 mt-3">
        {t(
          "p90 = nine out of ten signatures came faster than this. Computed in the app, not the database: this MongoDB is 6.x and $percentile needs 7+.",
          "الشريحة ٩٠ تعني أنّ تسعة من كل عشرة توقيعات كانت أسرع من هذا. تُحسَب في التطبيق لا في قاعدة البيانات: هذه النسخة MongoDB 6، و$percentile يتطلّب النسخة 7 فأعلى."
        )}
      </p>
    </>
  );
}

// ── rejections ─────────────────────────────────────────────────────────────
function RejectionReport({ data, stageName }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { lang, t } = useLang();
  const byStage = (data.byStage ?? []) as unknown as {
    stageIndex: number | null; count: number; kg: number; reached: number; ratePct: number | null; rejectors: string[];
  }[];
  const recent = (data.recent ?? []) as unknown as {
    _id: string; orderNumber: string; customer: string; customerAr?: string;
    totalWeightKg: number; updatedAt: string; rejection?: { reason?: string; byName?: string; stageIndex?: number | null };
  }[];
  if (!byStage.length) return <Empty>{t("No rejections in this period.", "لا توجد حالات رفض في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...byStage.map((s) => s.count));

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Rejected", "مرفوضة"), null, t("Reached it", "وصلتها"), t("Rate", "النسبة"), t("Tons lost", "أطنان مفقودة")]}>
        {byStage.map((s) => (
          <tr key={String(s.stageIndex)}>
            <td className="py-2 text-slate-800">
              {stageName(s.stageIndex)}
              {s.rejectors.length > 0 && (
                <span className="block text-xs text-slate-400">{s.rejectors.join(" · ")}</span>
              )}
            </td>
            <Num v={s.count} cls="text-slate-900 font-medium" />
            <td className="py-2 px-3 text-end"><Bar value={s.count} peak={peak} tone="red" /></td>
            <Num v={s.reached} cls="text-slate-400" />
            {/* The denominator is orders that REACHED the stage, not all orders:
                2 of 3 at finance is a different fact from 2 of 90. */}
            <Num v={s.ratePct !== null ? `${s.ratePct}%` : null} cls={((s.ratePct ?? 0) > 20 ? "text-red-700 font-medium" : "")} />
            <Num v={(s.kg / 1000).toFixed(1)} />
          </tr>
        ))}
      </Table>

      <h3 className="text-sm font-medium text-slate-900 mt-5 mb-2">{t("Most recent", "الأحدث")}</h3>
      <ul className="divide-y divide-slate-100">
        {recent.slice(0, 12).map((o) => (
          <li key={o._id} className="py-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <bdi className="font-mono text-xs text-red-700">{o.orderNumber}</bdi>
              <span className="text-sm text-slate-700">{(lang === "ar" && o.customerAr) || o.customer}</span>
              <span className="text-xs text-slate-400">{stageName(o.rejection?.stageIndex)}</span>
              <bdi className="text-xs text-slate-400 ms-auto">{formatDate(o.updatedAt)}</bdi>
            </div>
            <p className="text-xs text-slate-500">
              {o.rejection?.byName} — {o.rejection?.reason}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── variance ───────────────────────────────────────────────────────────────
function VarianceReport({ data }: { data: Record<string, never> }) {
  const { lang, t } = useLang();
  const rows = (data.byCustomer ?? []) as unknown as {
    customerId: string; name: string; nameAr: string;
    orders: number; orderedKg: number; actualKg: number; avgPct: number | null;
  }[];
  const outliers = (data.outliers ?? []) as unknown as VarianceOrderRow[];
  const overall = data.overall as unknown as { orders: number; orderedKg: number; actualKg: number } | null;
  if (!rows.length) return <Empty>{t("No posted orders in this period.", "لا توجد طلبيات مُرحَّلة في هذه الفترة.")}</Empty>;

  const diff = overall ? overall.actualKg - overall.orderedKg : 0;
  const diffPct = overall && overall.orderedKg ? (diff / overall.orderedKg) * 100 : 0;

  return (
    <>
      {overall && (
        <div className="flex flex-wrap gap-6 mb-4 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs text-slate-500">{t("Posted orders", "طلبيات مرحّلة")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{overall.orders}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Ordered", "المطلوب")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{(overall.orderedKg / 1000).toFixed(1)} {t("t", "طن")}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Actual", "الفعلي")}</p>
            <bdi className="text-xl font-semibold tabular-nums">{(overall.actualKg / 1000).toFixed(1)} {t("t", "طن")}</bdi>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("Net variance", "صافي الفرق")}</p>
            <bdi className={`text-xl font-semibold tabular-nums ${Math.abs(diffPct) > 0.5 ? "text-amber-700" : "text-slate-900"}`}>
              {diff > 0 ? "+" : ""}{(diff / 1000).toFixed(2)} {t("t", "طن")} ({diffPct > 0 ? "+" : ""}{diffPct.toFixed(2)}%)
            </bdi>
          </div>
        </div>
      )}

      <Table headers={[t("Customer", "الزبون"), t("Orders", "الطلبيات"), t("Ordered (t)", "المطلوب (طن)"), t("Actual (t)", "الفعلي (طن)"), t("Avg variance", "متوسط الفرق")]}>
        {rows.map((r) => (
          <tr key={r.customerId}>
            <td className="py-2 text-slate-800">{(lang === "ar" && r.nameAr) || r.name}</td>
            <Num v={r.orders} />
            <Num v={(r.orderedKg / 1000).toFixed(3)} />
            <Num v={(r.actualKg / 1000).toFixed(3)} />
            <Num
              v={r.avgPct !== null ? `${r.avgPct > 0 ? "+" : ""}${r.avgPct}%` : null}
              cls={Math.abs(r.avgPct ?? 0) > 0.5 ? "text-amber-700 font-medium" : ""}
            />
          </tr>
        ))}
      </Table>

      <OrdersTable
        title={t("Beyond ±1% — look at the load, not the average", "أكبر من ±١٪ — راجع الحمولة نفسها لا المتوسّط")}
        orders={outliers}
      />
    </>
  );
}

// ── weight trend — ordered vs weighed, by month ─────────────────────────────
const ORDERED_COLOR = "#2a78d6"; // same blue as the dashboard's "posted" ramp
const WEIGHED_COLOR = "#b91c1c"; // same red the app already uses for a shortfall
const TREND_AXIS_TICK = { fontSize: 11, fill: "#64748b" };
const TREND_GRID = "#f1f5f9";

function trendMonthLabel(year: number, month: number, lang: "en" | "ar"): string {
  return new Date(year, month, 1).toLocaleDateString(lang === "ar" ? "ar" : "en", {
    month: "short", year: "2-digit", numberingSystem: "latn",
  });
}

/** Recharts always lays out left-to-right; reversing the data array is what
 *  makes an Arabic reading of the same chart start at the most recent month —
 *  the same trick `charts.tsx` uses for the dashboard's own trend charts. */
function trendOrient<T>(data: T[], lang: "en" | "ar"): T[] {
  return lang === "ar" ? [...data].reverse() : data;
}

interface TrendPoint {
  label: string; year: number; month: number; ordered: number; weighed: number;
}

function WeightTrendReport({
  data, customerId, productId,
}: { data: Record<string, never>; customerId: string; productId: string }) {
  const { lang, t } = useLang();
  const months = (data.months ?? []) as unknown as {
    year: number; month: number; orderedKg: number; actualKg: number;
  }[];
  const hasAny = months.some((m) => m.orderedKg > 0 || m.actualKg > 0);

  const [selected, setSelected] = useState<{ year: number; month: number; label: string } | null>(null);
  const [drillOrders, setDrillOrders] = useState<VarianceOrderRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  // Recharts' click handler is only wired up once, on mount, against whatever
  // closure was current then — a later re-render's fresh `chartData` array
  // never reaches it. A ref sidesteps that: it's the same object identity
  // for the handler's whole lifetime, mutated in place every render, so the
  // handler always reads the current data through it.
  const chartDataRef = useRef<TrendPoint[]>([]);

  // A different tab/filter combination invalidates whatever point was
  // selected under the old data — closing the drill-down rather than
  // silently showing orders for a point that may no longer even be on screen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelected(null); }, [data, customerId, productId]);

  useEffect(() => {
    if (!selected) return;
    setDrillLoading(true);
    const p = new URLSearchParams({
      report: "weightTrendOrders", year: String(selected.year), month: String(selected.month),
    });
    if (customerId) p.set("customerId", customerId);
    if (productId) p.set("productId", productId);
    fetch(`/api/reports?${p}`)
      .then((r) => r.json())
      .then((d) => setDrillOrders(d.orders ?? []))
      .catch(() => setDrillOrders([]))
      .finally(() => setDrillLoading(false));
  }, [selected, customerId, productId]);

  // Computed unconditionally (never after the early `return` below) so the
  // ref-sync effect right after it keeps a stable hook count across renders.
  const chartData: TrendPoint[] = trendOrient(
    months.map((m) => ({
      label: trendMonthLabel(m.year, m.month, lang), year: m.year, month: m.month,
      ordered: Math.round((m.orderedKg / 1000) * 1000) / 1000,
      weighed: Math.round((m.actualKg / 1000) * 1000) / 1000,
    })),
    lang
  );
  useEffect(() => { chartDataRef.current = chartData; });

  if (!months.length || !hasAny) {
    return <Empty>{t("No posted orders in this period.", "لا توجد طلبيات مُرحَّلة في هذه الفترة.")}</Empty>;
  }

  return (
    <>
      <div className="h-80" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onClick={(state) => {
              const activeLabel = state?.activeLabel;
              const point = chartDataRef.current.find((p) => p.label === activeLabel);
              if (!point) return;
              setSelected((cur) =>
                cur && cur.year === point.year && cur.month === point.month
                  ? null
                  : { year: point.year, month: point.month, label: point.label }
              );
            }}
          >
            <CartesianGrid stroke={TREND_GRID} vertical={false} />
            <XAxis dataKey="label" tick={TREND_AXIS_TICK} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
            <YAxis
              tick={TREND_AXIS_TICK} axisLine={false} tickLine={false} width={40}
              label={{ value: t("t", "طن"), position: "insideTopLeft", fontSize: 11, fill: "#94a3b8" }}
            />
            <Tooltip
              formatter={(value, name) => [
                `${value} ${t("t", "طن")}`,
                name === "ordered" ? t("Ordered", "المطلوب") : t("Weighed", "الموزون"),
              ]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend
              formatter={(value) => (value === "ordered" ? t("Ordered", "المطلوب") : t("Weighed", "الموزون"))}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Line
              dataKey="ordered" name="ordered" type="monotone"
              stroke={ORDERED_COLOR} strokeWidth={2} dot={{ r: 3, fill: ORDERED_COLOR }}
            />
            <Line
              dataKey="weighed" name="weighed" type="monotone"
              stroke={WEIGHED_COLOR} strokeWidth={2} dot={{ r: 3, fill: WEIGHED_COLOR }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        {t(
          "Posted orders only. Blue = the line entered at order time. Red = the same line's own weighbridge reading. Click a point to see its orders.",
          "الطلبيات المرحّلة فقط. الأزرق = ما أُدخل في الطلبية. الأحمر = ما وُزن فعليًا لنفس البند. اضغط على نقطة لعرض طلبياتها."
        )}
      </p>

      {selected && (
        drillLoading ? (
          <p className="text-sm text-slate-400 mt-5">{t("Loading…", "جارٍ التحميل…")}</p>
        ) : (
          <OrdersTable title={`${t("Orders", "الطلبيات")} — ${selected.label}`} orders={drillOrders} />
        )
      )}
    </>
  );
}

// ── customers ──────────────────────────────────────────────────────────────
function CustomerReport({ data }: { data: Record<string, never> }) {
  const { lang, t } = useLang();
  const hours = useHours();
  const rows = (data.rows ?? []) as unknown as {
    customerId: string; name: string; nameAr: string;
    orders: number; orderedKg: number; posted: number; postedKg: number;
    rejected: number; rejectionPct: number; avgCycleHours: number | null; labFails: number;
  }[];
  if (!rows.length) return <Empty>{t("No orders in this period.", "لا توجد طلبيات في هذه الفترة.")}</Empty>;
  const peak = Math.max(1, ...rows.map((r) => r.orderedKg));

  return (
    <Table
      headers={[
        t("Customer", "الزبون"), t("Orders", "الطلبيات"), t("Ordered (t)", "المطلوب (طن)"), null,
        t("Posted", "مرحّلة"), t("Rejected", "مرفوضة"), t("Rejection rate", "نسبة الرفض"),
        t("Avg cycle", "متوسط الدورة"), t("Lab fails", "رسوب مخبري"),
      ]}
    >
      {rows.map((r) => (
        <tr key={r.customerId}>
          <td className="py-2 text-slate-800">{(lang === "ar" && r.nameAr) || r.name}</td>
          <Num v={r.orders} />
          <Num v={(r.orderedKg / 1000).toFixed(1)} cls="text-slate-900 font-medium" />
          <td className="py-2 px-3 text-end"><Bar value={r.orderedKg} peak={peak} /></td>
          <Num v={r.posted} />
          <Num v={r.rejected} />
          <Num v={`${r.rejectionPct}%`} cls={r.rejectionPct > 20 ? "text-red-700 font-medium" : "text-slate-500"} />
          <Num v={hours(r.avgCycleHours)} />
          <Num v={r.labFails || "—"} cls={r.labFails ? "text-red-700" : "text-slate-300"} />
        </tr>
      ))}
    </Table>
  );
}

// ── coverage ───────────────────────────────────────────────────────────────
function CoverageReport({ data, stageName }: { data: Record<string, never>; stageName: (i?: number | null) => string }) {
  const { t } = useLang();
  const rows = (data.byStage ?? []) as unknown as {
    stageIndex: number; total: number; kinds: Record<string, number>; people: string[]; coveredPct: number;
  }[];
  if (!rows.length) return <Empty>{t("No signatures in this period.", "لا توجد توقيعات في هذه الفترة.")}</Empty>;

  return (
    <>
      <Table headers={[t("Stage", "المرحلة"), t("Signatures", "توقيعات"), t("By the owner", "من صاحب المكتب"), t("Deputy", "نائب"), t("Delegate", "مفوّض"), t("Covered", "مغطّاة")]}>
        {rows.map((r) => (
          <tr key={r.stageIndex}>
            <td className="py-2 text-slate-800">
              <span className="font-mono text-xs text-slate-400 me-1.5">{r.stageIndex}</span>
              {stageName(r.stageIndex)}
              {r.people.length > 0 && (
                <span className="block text-xs text-slate-400">{r.people.join(" · ")}</span>
              )}
            </td>
            <Num v={r.total} />
            <Num v={r.kinds.primary ?? 0} />
            <Num v={r.kinds.deputy ?? 0} cls={r.kinds.deputy ? "text-amber-700" : "text-slate-300"} />
            <Num v={r.kinds.delegate ?? 0} cls={r.kinds.delegate ? "text-amber-700" : "text-slate-300"} />
            <Num v={`${r.coveredPct}%`} cls={r.coveredPct > 30 ? "text-amber-700 font-medium" : "text-slate-500"} />
          </tr>
        ))}
      </Table>
      <p className="text-xs text-slate-400 mt-3">
        {t(
          "A desk covered much of the time is a staffing fact, not a fault. It is visible only because every signature records who it was made on behalf of.",
          "المكتب الذي يُغطَّى كثيراً واقع توظيفي لا خطأ. ولا يظهر إلّا لأنّ كل توقيع يسجّل الشخص الذي وُقِّع نيابةً عنه."
        )}
      </p>
    </>
  );
}
