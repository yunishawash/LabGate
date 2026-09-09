"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { KpiPanel } from "@/components/lab/KpiPanel";
import { LabTrendChart, type LabTrendPoint } from "@/components/ui/lab-trend-chart";
import { useLang } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/utils";
import type { ILabSample, ILabProduct, ILabParameter } from "@/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * A customer's full quality history — KPI panel + a per-parameter control
 * chart + delivery history + export, all scoped to this one customer. Same
 * screen GWMC's `CustomerProfile` composes (filter bar → KPI panel →
 * parameter picker + trend chart → deliveries → export); the customer detail
 * page previously only had a lighter pass/warning/fail split.
 */
export function CustomerQualityProfile({ customerId }: { customerId: string }) {
  const { lang, t } = useLang();

  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [parameters, setParameters] = useState<ILabParameter[]>([]);
  const [samples, setSamples] = useState<ILabSample[]>([]);
  const [loading, setLoading] = useState(true);

  const [productFilter, setProductFilter] = useState("all");
  const [parameterFilter, setParameterFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    fetch("/api/lab/parameters").then((r) => r.json()).then((d) => setParameters(d.parameters || [])).catch(() => {});
  }, []);

  // Default to the first parameter once the catalog arrives.
  useEffect(() => {
    if (!parameterFilter && parameters.length > 0) setParameterFilter(parameters[0]._id);
  }, [parameters, parameterFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ customer: customerId, limit: "300" });
    if (productFilter !== "all") params.set("product", productFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const res = await fetch(`/api/lab/samples?${params}`);
      const data = await res.json();
      setSamples(data.samples || []);
    } catch {
      setSamples([]);
    }
    setLoading(false);
  }, [customerId, productFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  // `samples` comes back newest-first (the API's own sort). The chart wants
  // oldest→newest so the line reads left to right in date order.
  const chartData: LabTrendPoint[] = useMemo(() => {
    return [...samples]
      .reverse()
      .map((s): LabTrendPoint | null => {
        const line = s.results.find((r) => r.parameterId === parameterFilter);
        if (!line) return null;
        return {
          sampleNumber: s.sampleNumber, date: s.sampleDate, value: line.value,
          status: line.status, batchId: s.batchId,
        };
      })
      .filter((p): p is LabTrendPoint => p !== null);
  }, [samples, parameterFilter]);

  // Limits are snapshotted per result, not re-resolved — read them off the
  // MOST RECENT matching reading (samples is still newest-first here), since
  // that's the spec that actually applied most recently for this customer.
  const chartLimits = useMemo(() => {
    for (const s of samples) {
      const line = s.results.find((r) => r.parameterId === parameterFilter);
      if (line) return { min: line.min, max: line.max, target: line.target };
    }
    return { min: null, max: null, target: null };
  }, [samples, parameterFilter]);

  const selectedParameter = parameters.find((p) => p._id === parameterFilter);

  const exportProfile = () => {
    const p = new URLSearchParams({ type: "lab", customer: customerId, lang });
    if (productFilter !== "all") p.set("product", productFilter);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    window.location.assign(`/api/export?${p}`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3 shadow-sm">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">{t("Product", "المنتج")}</Label>
          <Combobox
            triggerClassName={SELECT_CLASS + " w-40"}
            value={productFilter}
            onChange={setProductFilter}
            options={[
              { value: "all", label: t("All products", "كل المنتجات") },
              ...products.map((p) => ({ value: p._id, label: p.name })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">{t("From", "من")}</Label>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">{t("To", "إلى")}</Label>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <Button size="sm" variant="outline" className="ms-auto gap-1.5" onClick={exportProfile}>
          <Download size={14} />
          {t("Export", "تصدير")}
        </Button>
      </div>

      <KpiPanel filters={{ customer: customerId, product: productFilter, from, to }} />

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">{t("Delivered Quality Trend", "اتجاه الجودة المورَّدة")}</h3>
            <p className="text-xs text-slate-400">
              {t("What this customer actually received, against spec.", "ما استلمه هذا الزبون فعليًا، مقابل المواصفة.")}
            </p>
          </div>
          <Combobox
            triggerClassName={SELECT_CLASS + " w-56"}
            value={parameterFilter}
            onChange={setParameterFilter}
            options={parameters.map((p) => ({
              value: p._id,
              label: p.unit ? `${p.name} (${p.unit})` : p.name,
            }))}
          />
        </div>
        <LabTrendChart
          data={chartData}
          min={chartLimits.min}
          max={chartLimits.max}
          target={chartLimits.target}
          unit={selectedParameter?.unit}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="font-semibold text-slate-900 px-4 py-3 border-b border-slate-100">
          {t("Deliveries", "التوريدات")} ({samples.length})
        </h3>
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : samples.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">{t("No samples for this selection.", "لا توجد عيّنات لهذا التحديد.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-start font-medium px-4 py-2">{t("Sample #", "رقم العيّنة")}</th>
                  <th className="text-start font-medium px-4 py-2">{t("Batch", "الدفعة")}</th>
                  <th className="text-start font-medium px-4 py-2">{t("Date", "التاريخ")}</th>
                  <th className="text-start font-medium px-4 py-2">{t("Product", "المنتج")}</th>
                  <th className="text-start font-medium px-4 py-2">{t("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {samples.map((s) => (
                  <tr key={s._id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-sky-700">{s.sampleNumber}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{s.batchId || "—"}</td>
                    <td className="px-4 py-2 text-xs"><bdi>{formatDate(s.sampleDate)}</bdi></td>
                    <td className="px-4 py-2">{s.product}</td>
                    <td className="px-4 py-2"><QcStatusBadge status={s.overallStatus} size="xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
