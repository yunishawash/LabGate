"use client";
import { useCallback, useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, FlaskConical, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { StatCard } from "@/components/ui/stat-card";
import { useLang } from "@/components/layout/AppShell";
import { InSpecChart, StatusSplitBar, type InSpecRow } from "@/components/ui/lab-charts";
import { QC_RATING_LABELS, type ILabStatRow, type ILabProduct, type QcRating } from "@/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

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

export function KpiPanel({ products }: { products: ILabProduct[] }) {
  const { lang, t } = useLang();

  const [product, setProduct] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [rows, setRows] = useState<ILabStatRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (product !== "all") params.set("product", product);
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
  }, [product, from, to]);

  useEffect(() => { load(); }, [load]);

  // One bar per parameter, worst first — the eye should land on the problem.
  const chartRows: InSpecRow[] = [...rows]
    .sort((a, b) => a.inSpecPct - b.inSpecPct)
    .slice(0, 12)
    .map((r) => ({
      label: `${r.parameterName}${product === "all" ? ` · ${r.product}` : ""}`,
      value: Math.round(r.inSpecPct * 10) / 10,
      count: r.count,
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          triggerClassName={SELECT_CLASS + " w-44"}
          value={product}
          onChange={setProduct}
          options={[
            { value: "all", label: t("All products", "كل الأصناف") },
            ...products.map((p) => ({ value: p._id, label: (lang === "ar" && p.nameAr) || p.name })),
          ]}
        />
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
      </div>

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
