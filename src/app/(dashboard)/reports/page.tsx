"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ArrowLeft, ArrowRight, BarChart3, Download } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { formatDate } from "@/lib/utils";
import { productPickerOptions } from "@/types";
import type { ILabProduct, LabStatus, LinePackaging } from "@/types";

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

type ReportKey = "orders" | "variance" | "weightTrend" | "customers";

const TABS: { key: ReportKey; en: string; ar: string; question: [string, string] }[] = [
  { key: "orders", en: "Orders", ar: "الطلبيات",
    question: ["Every order, line by line", "كل طلبية، بندًا بندًا"] },
  { key: "variance", en: "Weight variance", ar: "فروقات الوزن",
    question: ["Are we shipping what we sold?", "هل نشحن ما بعناه فعلاً؟"] },
  { key: "weightTrend", en: "Ordered vs weighed", ar: "المطلوب مقابل الموزون",
    question: ["Ordered vs weighed, month by month", "المطلوب مقابل الموزون، شهرًا بشهر"] },
  { key: "customers", en: "Customers", ar: "الزبائن",
    question: ["Who are our real customers?", "من هم زبائننا الحقيقيون؟"] },
];

/** Orders, Weight variance and Ordered-vs-weighed share the same three
 *  filters (customer, product, date). Customers has none — its own report is
 *  already an all-time roll-up per customer. */
const FILTERED_TABS: ReportKey[] = ["orders", "variance", "weightTrend"];

export default function ReportsPage() {
  const { lang, t } = useLang();
  const [tab, setTab] = useState<ReportKey>("orders");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, never> | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<{ _id: string; name: string; nameAr?: string }[]>([]);
  const [products, setProducts] = useState<ILabProduct[]>([]);

  useEffect(() => {
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
  }, []);

  const usesFilters = FILTERED_TABS.includes(tab);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ report: tab });
    if (usesFilters) {
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (customerIds.length) p.set("customerIds", customerIds.join(","));
      if (productIds.length) p.set("productIds", productIds.join(","));
    }
    try {
      const res = await fetch(`/api/reports?${p}`);
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [tab, from, to, customerIds, productIds, usesFilters]);

  useEffect(() => { load(); }, [load]);

  const download = () => {
    const p = new URLSearchParams({ type: "ordersDetail", lang });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (customerIds.length) p.set("customerIds", customerIds.join(","));
    if (productIds.length) p.set("productIds", productIds.join(","));
    // `assign()` rather than assigning to `location.href`: React Compiler
    // rejects writing to a global, and the response is Content-Disposition:
    // attachment, so the browser downloads it without leaving the page.
    window.location.assign(`/api/export?${p}`);
  };

  const active = TABS.find((x) => x.key === tab)!;
  const customerOptions = customers.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name }));
  const productOptions = productPickerOptions(products, lang);

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
          {usesFilters && (
            <>
              <MultiCombobox
                values={customerIds}
                onChange={setCustomerIds}
                options={customerOptions}
                placeholder={t("All customers", "كل الزبائن")}
                className="h-9 w-40 text-sm"
              />
              <MultiCombobox
                values={productIds}
                onChange={setProductIds}
                options={productOptions}
                placeholder={t("All products", "كل الأصناف")}
                className="h-9 w-40 text-sm"
              />
              <DateRangePicker from={from} to={to} onChange={(f, toVal) => { setFrom(f); setTo(toVal); }} />
            </>
          )}
          {tab === "orders" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={download}>
              <Download size={14} />
              {t("Export", "تصدير")}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        {loading && <p className="text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !data && (
          <p className="text-sm text-red-600">{t("Could not load this report.", "تعذّر تحميل التقرير.")}</p>
        )}

        {!loading && data && tab === "orders" && <OrdersDetailReport data={data} />}
        {!loading && data && tab === "variance" && <VarianceReport data={data} />}
        {!loading && data && tab === "weightTrend" && (
          <WeightTrendReport data={data} customerIds={customerIds} productIds={productIds} />
        )}
        {!loading && data && tab === "customers" && <CustomerReport data={data} />}
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

// ── orders — every order, line by line ──────────────────────────────────────
interface OrderDetailLine {
  productId: string; product: string; productAr?: string;
  packaging?: LinePackaging;
  bagWeightKg: number | null; bagCount: number | null; lineWeightKg: number;
  actualWeightKg: number | null; labStatus: string | null;
}
interface OrderDetailRow {
  _id: string; orderNumber: string; customer: string; customerAr?: string;
  orderDate: string; deliveryDate: string | null; lines: OrderDetailLine[];
}

const ORDERS_PAGE_SIZE = 20;

function OrdersDetailReport({ data }: { data: Record<string, never> }) {
  const { lang, t } = useLang();
  const allOrders = (data.orders ?? []) as unknown as OrderDetailRow[];
  const [page, setPage] = useState(0);
  // A new filter/date range invalidates whatever page was open — reopening on
  // page 3 of a now-much-shorter list would just show an empty table.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [data]);

  if (!allOrders.length) return <Empty>{t("No orders in this period.", "لا توجد طلبيات في هذه الفترة.")}</Empty>;

  const pageCount = Math.max(1, Math.ceil(allOrders.length / ORDERS_PAGE_SIZE));
  const orders = allOrders.slice(page * ORDERS_PAGE_SIZE, (page + 1) * ORDERS_PAGE_SIZE);

  return (
    <>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-500 border-b border-slate-200">
          <th className="font-medium py-2 text-start">{t("Order", "رقم الطلبية")}</th>
          <th className="font-medium py-2 text-start">{t("Customer", "الزبون")}</th>
          <th className="font-medium py-2 text-start whitespace-nowrap">{t("Created", "تاريخ الإنشاء")}</th>
          <th className="font-medium py-2 text-start whitespace-nowrap">{t("Delivery", "تاريخ التسليم")}</th>
          <th className="font-medium py-2 text-start">{t("Product", "الصنف")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Bag", "الكيس")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Bags", "الأكياس")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Weight", "الوزن")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Actual", "الوزن الفعلي")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Difference", "الفرق")}</th>
          <th className="font-medium py-2 text-end px-3">{t("Lab result", "نتيجة المختبر")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {orders.map((o) =>
          o.lines.map((l, i) => {
            const diffKg = l.actualWeightKg != null ? l.actualWeightKg - l.lineWeightKg : null;
            return (
              <tr key={`${o._id}-${l.productId}-${i}`}>
                {i === 0 && (
                  <>
                    <td className="py-2 align-top" rowSpan={o.lines.length}>
                      <Link href={`/orders/${o._id}`} className="font-mono text-xs text-sky-700 hover:underline">
                        <bdi>{o.orderNumber}</bdi>
                      </Link>
                    </td>
                    <td className="py-2 align-top text-slate-800" rowSpan={o.lines.length}>
                      {(lang === "ar" && o.customerAr) || o.customer}
                    </td>
                    <td className="py-2 align-top text-slate-500 whitespace-nowrap" rowSpan={o.lines.length}>
                      <bdi>{formatDate(o.orderDate)}</bdi>
                    </td>
                    <td className="py-2 align-top text-slate-500 whitespace-nowrap" rowSpan={o.lines.length}>
                      {o.deliveryDate ? <bdi>{formatDate(o.deliveryDate)}</bdi> : "—"}
                    </td>
                  </>
                )}
                <td className="py-2 text-slate-700">{(lang === "ar" && l.productAr) || l.product}</td>
                {/* A poured line has no sack size and nothing to count. One
                    merged cell saying so beats two dashes the reader has to
                    interpret. */}
                {l.packaging === "bulk" ? (
                  <td className="py-2 px-3 text-center whitespace-nowrap" colSpan={2}>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {t("Bulk", "صبّ")}
                    </span>
                  </td>
                ) : (
                  <>
                    <Num v={l.bagWeightKg != null ? `${l.bagWeightKg} kg` : "—"} />
                    <Num v={l.bagCount ?? "—"} />
                  </>
                )}
                <Num v={(l.lineWeightKg / 1000).toFixed(3)} />
                <Num v={l.actualWeightKg != null ? (l.actualWeightKg / 1000).toFixed(3) : null} />
                <Num
                  v={diffKg != null ? `${diffKg > 0 ? "+" : ""}${(diffKg / 1000).toFixed(3)}` : null}
                  cls={diffKg && Math.abs(diffKg) > 0 ? "text-amber-700 font-medium" : ""}
                />
                <td className="py-2 px-3 text-end">
                  {l.labStatus ? <QcStatusBadge status={l.labStatus as LabStatus} size="xs" /> : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
    {pageCount > 1 && (
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {lang === "ar" ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
        </button>
        <span className="text-xs text-slate-500">
          {t(`Page ${page + 1} of ${pageCount}`, `صفحة ${page + 1} من ${pageCount}`)}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={page >= pageCount - 1}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {lang === "ar" ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
        </button>
      </div>
    )}
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
  data, customerIds, productIds,
}: { data: Record<string, never>; customerIds: string[]; productIds: string[] }) {
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
  useEffect(() => { setSelected(null); }, [data, customerIds, productIds]);

  useEffect(() => {
    if (!selected) return;
    setDrillLoading(true);
    const p = new URLSearchParams({
      report: "weightTrendOrders", year: String(selected.year), month: String(selected.month),
    });
    if (customerIds.length) p.set("customerIds", customerIds.join(","));
    if (productIds.length) p.set("productIds", productIds.join(","));
    fetch(`/api/reports?${p}`)
      .then((r) => r.json())
      .then((d) => setDrillOrders(d.orders ?? []))
      .catch(() => setDrillOrders([]))
      .finally(() => setDrillLoading(false));
  }, [selected, customerIds, productIds]);

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
