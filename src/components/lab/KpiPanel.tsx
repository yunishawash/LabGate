"use client";
import { useCallback, useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, FlaskConical, Activity } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { useLang } from "@/components/layout/AppShell";
import { InSpecChart, StatusSplitBar, type InSpecRow } from "@/components/ui/lab-charts";
import { QC_RATING_LABELS, type ILabStatRow, type QcRating } from "@/types";

/**
 * Filters this panel reads — a plain object, not URL/component state it owns
 * itself. It needs to be embeddable both standalone (the Lab page's KPI tab,
 * which owns a product/date filter bar) and inside a customer's quality
 * profile (which needs that SAME filter bar to also drive a trend chart and a
 * delivery table at once — two independent pickers on one screen would be
 * wrong). One shared bar upstream, this panel just renders what it's told.
 */
export interface LabKpiFilters {
  product?: string;   // ObjectId, or "all"/undefined to mean no filter
  customer?: string;  // ObjectId, or "all"/undefined
  shift?: string;
  from?: string;       // yyyy-mm-dd
  to?: string;
}

interface Summary {
  totalSamples: number;
  failedSamples: number;
  warningSamples: number;
  passedSamples: number;
  sampleInSpecPct: number | null;
  avgInSpecPct: number | null;
  avgCvPct: number | null;
  needsAttention: number;
}

const RATING_BADGE: Record<QcRating, string> = {
  excellent: "bg-emerald-100 text-emerald-700",
  good: "bg-sky-100 text-sky-700",
  needs_attention: "bg-red-100 text-red-700",
};

export function KpiPanel({ filters }: { filters: LabKpiFilters }) {
  const { lang, t } = useLang();

  const [rows, setRows] = useState<ILabStatRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const { product, customer, shift, from, to } = filters;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (product && product !== "all") params.set("product", product);
    if (customer && customer !== "all") params.set("customer", customer);
    if (shift && shift !== "all") params.set("shift", shift);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const res = await fetch(`/api/lab/stats?${params}`);
      const data = await res.json();
      setRows(data.rows || []);
      setSummary(data.summary ?? null);
    } catch {
      setRows([]); setSummary(null);
    }
    setLoading(false);
    // Depend on the individual primitive fields, not `filters` itself — a
    // caller can pass a fresh object literal every render with no useMemo.
  }, [product, customer, shift, from, to]);

  useEffect(() => { load(); }, [load]);

  // One bar per parameter, worst first — the eye should land on the problem.
  const chartRows: InSpecRow[] = [...rows]
    .sort((a, b) => a.inSpecPct - b.inSpecPct)
    .slice(0, 12)
    .map((r) => ({
      label: `${r.parameterName}${!product || product === "all" ? ` · ${r.product}` : ""}`,
      value: Math.round(r.inSpecPct * 10) / 10,
      count: r.count,
    }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t("Samples", "العيّنات")} value={summary?.totalSamples ?? 0} icon={<FlaskConical size={18} />} color="blue" />
        <StatCard
          title={t("Samples in spec", "عيّنات مطابقة")}
          value={summary?.sampleInSpecPct == null ? "—" : `${summary.sampleInSpecPct.toFixed(0)}%`}
          icon={<TrendingUp size={18} />}
          color="green"
        />
        <StatCard
          title={t("Avg variation (CV)", "متوسط التشتت")}
          value={summary?.avgCvPct == null ? "—" : `${summary.avgCvPct.toFixed(1)}%`}
          icon={<Activity size={18} />}
          color="default"
        />
        <StatCard
          title={t("Need attention", "تحتاج إلى متابعة")}
          value={summary?.needsAttention ?? 0}
          icon={<AlertTriangle size={18} />}
          color={summary?.needsAttention ? "red" : "default"}
        />
      </div>

      {summary && summary.totalSamples > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-medium text-slate-800 mb-3">
            {t("Verdict split", "توزيع الأحكام")}
          </h3>
          <StatusSplitBar
            split={{
              pass: summary.passedSamples,
              warning: summary.warningSamples,
              fail: summary.failedSamples,
            }}
          />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-sm font-medium text-slate-800">
          {t("In-spec rate by parameter", "نسبة المطابقة لكل بارامتر")}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">
          {t("Worst first. Warnings count as in spec.", "الأسوأ أولاً. التحذيرات محسوبة ضمن المطابق.")}
        </p>
        {loading ? (
          <div className="h-40 grid place-items-center text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</div>
        ) : (
          <InSpecChart rows={chartRows} />
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="text-start font-medium px-4 py-2.5">{t("Product", "الصنف")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Parameter", "البارامتر")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Readings", "القراءات")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Average", "المتوسط")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Variation", "التشتت")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("In spec", "المطابقة")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Rating", "التقييم")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                {t("No readings in this range.", "لا توجد قراءات ضمن هذا المدى.")}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={`${r.productId}-${r.parameterId}`} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-slate-700">{r.product}</td>
                <td className="px-3 py-2.5 text-slate-800">{r.parameterName}</td>
                <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.count}</td>
                <td className="px-3 py-2.5">
                  <bdi className="tabular-nums text-slate-800">
                    {r.average.toFixed(2)}{r.unit && <span className="text-slate-400"> {r.unit}</span>}
                  </bdi>
                </td>
                <td className="px-3 py-2.5">
                  <bdi className="tabular-nums text-slate-600">
                    {r.cvPct == null ? "—" : `${r.cvPct.toFixed(1)}%`}
                  </bdi>
                </td>
                <td className="px-3 py-2.5">
                  <bdi className="tabular-nums text-slate-800">{r.inSpecPct.toFixed(0)}%</bdi>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${RATING_BADGE[r.rating]}`}>
                    {QC_RATING_LABELS[r.rating][lang]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
