"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Paperclip, Pencil, Search, X, Download } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { DecisionBadge } from "@/components/ui/decision-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SampleDialog } from "@/components/lab/SampleDialog";
import { ProductSpecsTab } from "@/components/lab/ProductSpecsTab";
import { CustomersTab } from "@/components/lab/CustomersTab";
import { KpiPanel } from "@/components/lab/KpiPanel";
import { LabTrendChart, type LabTrendPoint } from "@/components/ui/lab-trend-chart";
import { formatDate, toDateInputValue } from "@/lib/utils";
import {
  LAB_SHIFT_LABELS, LAB_OPERATOR_LABELS,
  type ILabSample, type ILabProduct, type ILabCustomer, type ILabParameter, type LabShift,
} from "@/types";

type Tab = "results" | "specs" | "customers" | "kpi";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

export default function LabPage() {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role ?? "";
  const canRecord = role === "admin" || role === "lab_technician" || role === "technical_manager";

  const [tab, setTab] = useState<Tab>("results");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ILabSample | null>(null);
  // Read-only detail — open to ANY signed-in user, unlike the edit dialog.
  // Someone approving stage 7 on an order needs to see the actual readings,
  // not just the pass/fail rollup, even without lab_technician permission.
  const [viewSample, setViewSample] = useState<ILabSample | null>(null);

  // Filters live in component state, not the URL — the house convention.
  const [samples, setSamples] = useState<ILabSample[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [customers, setCustomers] = useState<ILabCustomer[]>([]);
  const [parameters, setParameters] = useState<ILabParameter[]>([]);

  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [status, setStatus] = useState("all");
  const [shift, setShift] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [parameterFilter, setParameterFilter] = useState("");

  const hasFilters =
    !!search || product !== "all" || customer !== "all" ||
    status !== "all" || shift !== "all" || !!from || !!to;

  const clearFilters = () => {
    setSearch(""); setProduct("all"); setCustomer("all");
    setStatus("all"); setShift("all"); setFrom(""); setTo("");
    setPage(1);
  };

  const loadProducts = useCallback(() => {
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
  }, []);
  const loadCustomers = useCallback(() => {
    // This is a PICKER, not the paginated Customers table — it needs the whole
    // register to search over, hence the explicit high limit.
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);
  const loadParameters = useCallback(() => {
    fetch("/api/lab/parameters").then((r) => r.json()).then((d) => setParameters(d.parameters || [])).catch(() => {});
  }, []);

  useEffect(() => { loadProducts(); loadCustomers(); loadParameters(); }, [loadProducts, loadCustomers, loadParameters]);

  // Default to the first parameter once the catalog arrives, for the control chart below.
  useEffect(() => {
    if (!parameterFilter && parameters.length > 0) setParameterFilter(parameters[0]._id);
  }, [parameters, parameterFilter]);

  // Shared by the table fetch, the chart's own (wider, unpaginated) fetch,
  // and the export button — one filter bar, three consumers of the same
  // query shape.
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (product !== "all") params.set("product", product);
    if (customer !== "all") params.set("customer", customer);
    if (status !== "all") params.set("status", status);
    if (shift !== "all") params.set("shift", shift);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [search, product, customer, status, shift, from, to]);

  const fetchSamples = useCallback(async () => {
    setLoading(true);
    const params = buildFilterParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    try {
      const res = await fetch(`/api/lab/samples?${params}`);
      const data = await res.json();
      setSamples(data.samples || []);
      setTotal(data.total || 0);
    } catch {
      setSamples([]); setTotal(0);
    }
    setLoading(false);
  }, [buildFilterParams, page, limit]);

  useEffect(() => { fetchSamples(); }, [fetchSamples]);

  // Control chart series: a wider, unpaginated slice for the selected
  // parameter, independent of the table's own page/limit — the trend isn't
  // limited to one page of rows.
  const [chartSamples, setChartSamples] = useState<ILabSample[]>([]);
  const fetchChartSeries = useCallback(async () => {
    if (!parameterFilter) return;
    const params = buildFilterParams();
    params.set("parameterId", parameterFilter);
    params.set("limit", "300");
    try {
      const res = await fetch(`/api/lab/samples?${params}`);
      const data = await res.json();
      // Newest-first from the API; reversed so the chart reads oldest→newest.
      setChartSamples((data.samples || []).slice().reverse());
    } catch {
      setChartSamples([]);
    }
  }, [buildFilterParams, parameterFilter]);

  useEffect(() => { fetchChartSeries(); }, [fetchChartSeries]);

  const chartData: LabTrendPoint[] = chartSamples
    .map((s): LabTrendPoint | null => {
      const line = s.results.find((r) => r.parameterId === parameterFilter);
      if (!line) return null;
      return {
        sampleNumber: s.sampleNumber, date: s.sampleDate, value: line.value,
        status: line.status, batchId: s.batchId, customer: s.customer,
      };
    })
    .filter((p): p is LabTrendPoint => p !== null);

  // Limits are snapshotted per result, not re-resolved — read the most recent
  // matching reading (chartSamples is oldest→newest, so walk from the end).
  // With no reading at all yet for this filter combination, fall back to the
  // parameter's own plant-wide defaults so the chart still shows a spec.
  const chartLimits = (() => {
    for (let i = chartSamples.length - 1; i >= 0; i--) {
      const line = chartSamples[i].results.find((r) => r.parameterId === parameterFilter);
      if (line) return { min: line.min, max: line.max, target: line.target };
    }
    const p = parameters.find((x) => x._id === parameterFilter);
    return { min: p?.defaultMin ?? null, max: p?.defaultMax ?? null, target: p?.defaultTarget ?? null };
  })();

  const selectedParameter = parameters.find((p) => p._id === parameterFilter);

  // Same GET-navigation pattern as the Reports page: `assign()` rather than
  // `location.href` (the React Compiler rejects writing to a global), and the
  // response is Content-Disposition: attachment, so it downloads without
  // leaving the page. Always matches whatever the Results tab has on screen.
  const downloadLab = () => {
    const p = buildFilterParams();
    p.set("type", "lab");
    p.set("lang", lang);
    window.location.assign(`/api/export?${p}`);
  };

  const counts = samples.reduce(
    (acc, s) => { acc[s.overallStatus] = (acc[s.overallStatus] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const columns: Column<ILabSample>[] = [
    {
      key: "sampleNumber",
      label: t("Sample #", "رقم العيّنة"),
      render: (s) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-900">{s.sampleNumber}</span>
            {s.attachments?.length > 0 && <Paperclip size={12} className="text-slate-400 flex-shrink-0" />}
          </div>
          {/* An order number here is the tell that this sample came through the
              approval chain rather than routine shift QC. */}
          {s.orderNumber ? (
            <span className="text-xs text-sky-600 font-mono">{s.orderNumber}</span>
          ) : s.batchId ? (
            <span className="text-xs text-slate-400">{s.batchId}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "sampleDate",
      label: t("Date", "التاريخ"),
      render: (s) => (
        <div className="min-w-0">
          <bdi className="text-slate-700 block">{formatDate(s.sampleDate)}</bdi>
          {s.shift && (
            <span className="text-xs text-slate-400">
              {LAB_SHIFT_LABELS[s.shift as Exclude<LabShift, "">]?.[lang]}
            </span>
          )}
        </div>
      ),
    },
    { key: "product", label: t("Product", "الصنف"), render: (s) => s.product || "—" },
    { key: "customer", label: t("Customer", "الزبون"), render: (s) => s.customer || "—" },
    { key: "testedByName", label: t("Tested by", "الفاحص"), render: (s) => s.testedByName || "—" },
    {
      key: "results",
      label: t("Readings", "القراءات"),
      render: (s) => {
        const pass = s.results.filter((r) => r.status === "pass").length;
        const warn = s.results.filter((r) => r.status === "warning").length;
        const fail = s.results.filter((r) => r.status === "fail").length;
        return (
          <span className="font-mono text-xs tabular-nums">
            <span className="text-emerald-700">{pass}</span>
            <span className="text-slate-300"> · </span>
            <span className="text-amber-600">{warn}</span>
            <span className="text-slate-300"> · </span>
            <span className="text-red-700">{fail}</span>
          </span>
        );
      },
    },
    { key: "overallStatus", label: t("Verdict", "الحكم"), render: (s) => <QcStatusBadge status={s.overallStatus} /> },
    { key: "finalDecision", label: t("Sign-off", "الاعتماد"), render: (s) => <DecisionBadge decision={s.finalDecision} /> },
  ];

  const TABS: { key: Tab; en: string; ar: string; visible: boolean }[] = [
    { key: "results",   en: "Results",           ar: "النتائج",           visible: true },
    { key: "specs",     en: "Products & Specs",  ar: "المنتجات والمواصفات", visible: canRecord },
    { key: "customers", en: "Customers",         ar: "الزبائن",           visible: true },
    { key: "kpi",       en: "Quality KPIs",      ar: "مؤشرات الجودة",     visible: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <FlaskConical size={22} className="text-cyan-600" />
            {t("Lab", "المختبر")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              "Sample results, product specifications and quality trends.",
              "نتائج العيّنات ومواصفات المنتجات ومؤشرات الجودة."
            )}
          </p>
        </div>
        {tab === "results" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadLab}>
              <Download size={14} />
              {t("Export", "تصدير")}
            </Button>
            {canRecord && (
              <Button className="gap-2" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus size={16} />
                {t("New sample", "عيّنة جديدة")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.filter((x) => x.visible).map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={
              "px-4 py-2.5 text-sm whitespace-nowrap cursor-pointer border-b-2 -mb-px " +
              (tab === x.key
                ? "border-sky-500 text-sky-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {lang === "ar" ? x.ar : x.en}
          </button>
        ))}
      </div>

      {tab === "results" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard title={t("Samples (page)", "عيّنات الصفحة")} value={samples.length} icon={<FlaskConical size={18} />} color="blue" />
            <StatCard title={t("In spec", "مطابق")} value={counts.pass ?? 0} icon={<FlaskConical size={18} />} color="green" />
            <StatCard title={t("Warning", "تحذير")} value={counts.warning ?? 0} icon={<FlaskConical size={18} />} color="yellow" />
            <StatCard title={t("Out of range", "خارج النطاق")} value={counts.fail ?? 0} icon={<FlaskConical size={18} />} color="red" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={15} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={t("Sample, batch or order #", "رقم العيّنة أو الدفعة أو الطلبية")}
                className="h-9 w-64 ps-8"
              />
            </div>

            <Combobox
              triggerClassName={SELECT_CLASS + " w-44"}
              value={product}
              onChange={(v) => { setProduct(v); setPage(1); }}
              options={[
                { value: "all", label: t("All products", "كل الأصناف") },
                ...products.map((p) => ({ value: p._id, label: p.name })),
              ]}
            />

            <Combobox
              triggerClassName={SELECT_CLASS + " w-44"}
              value={customer}
              onChange={(v) => { setCustomer(v); setPage(1); }}
              options={[
                { value: "all", label: t("All customers", "كل الزبائن") },
                ...customers.map((c) => ({ value: c._id, label: c.name })),
              ]}
            />

            <Combobox
              triggerClassName={SELECT_CLASS + " w-40"}
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: "all", label: t("Any verdict", "كل الأحكام") },
                { value: "pass", label: t("In spec", "مطابق") },
                { value: "warning", label: t("Warning", "تحذير") },
                { value: "fail", label: t("Out of range", "خارج النطاق") },
              ]}
            />

            <Combobox
              triggerClassName={SELECT_CLASS + " w-36"}
              value={shift}
              onChange={(v) => { setShift(v); setPage(1); }}
              options={[
                { value: "all", label: t("Any shift", "كل الورديات") },
                ...(["morning", "afternoon", "night"] as const).map((s) => ({ value: s, label: LAB_SHIFT_LABELS[s][lang] })),
              ]}
            />

            <Input type="date" value={from} max={to || undefined}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-40" />
            <Input type="date" value={to} min={from || undefined} max={toDateInputValue(new Date())}
              onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-40" />

            {hasFilters && (
              <button onClick={clearFilters} className="h-9 px-3 rounded-lg text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5">
                <X size={14} />
                {t("Clear", "مسح")}
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{t("Control Chart", "مخطط المراقبة")}</h3>
                <p className="text-xs text-slate-400">
                  {t(
                    "Amber zones mark the last 15% of the range before each limit.",
                    "المناطق الكهرمانية تمثل آخر ١٥٪ من النطاق قبل كل حد."
                  )}
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

          <DataTable<ILabSample>
            columns={columns}
            data={samples}
            total={total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
            loading={loading}
            onRowClick={(s) => setViewSample(s)}
            emptyMessage={
              hasFilters
                ? t("No samples match these filters.", "لا توجد عيّنات مطابقة لهذه المرشِّحات.")
                : t("No samples recorded yet.", "لا توجد عيّنات مسجّلة بعد.")
            }
          />
        </>
      )}

      <SampleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { fetchSamples(); fetchChartSeries(); }}
        products={products}
        customers={customers}
        editing={editing}
      />

      {/* Read-only detail — every signed-in user can open it from the table;
          only canRecord gets an Edit button inside. Same content shape as
          GWMC's sample-detail view: header fields, the full per-parameter
          table (spec + deviation + status, not just the value), attachments,
          notes, and the final-decision block. */}
      <Dialog open={!!viewSample} onOpenChange={(o) => !o && setViewSample(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <FlaskConical size={18} className="text-cyan-600" />
              {viewSample?.sampleNumber}
              {viewSample && <QcStatusBadge status={viewSample.overallStatus} />}
              {viewSample && viewSample.finalDecision !== "pending" && (
                <DecisionBadge decision={viewSample.finalDecision} />
              )}
            </DialogTitle>
          </DialogHeader>
          {viewSample && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-slate-500">{t("Product", "الصنف")}</Label><p>{viewSample.product}</p></div>
                <div><Label className="text-xs text-slate-500">{t("Customer", "الزبون")}</Label><p>{viewSample.customer || "—"}</p></div>
                <div><Label className="text-xs text-slate-500">{t("Date", "التاريخ")}</Label><p>{formatDate(viewSample.sampleDate)}</p></div>
                <div>
                  <Label className="text-xs text-slate-500">{t("Shift", "الوردية")}</Label>
                  <p>{viewSample.shift ? LAB_SHIFT_LABELS[viewSample.shift as Exclude<LabShift, "">]?.[lang] : "—"}</p>
                </div>
                <div><Label className="text-xs text-slate-500">{t("Batch / Lot", "الدفعة")}</Label><p>{viewSample.batchId || "—"}</p></div>
                <div><Label className="text-xs text-slate-500">{t("Tested by", "الفاحص")}</Label><p>{viewSample.testedByName}</p></div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-start font-medium px-3 py-1.5">{t("Parameter", "البارامتر")}</th>
                      <th className="text-end font-medium px-3 py-1.5">{t("Result", "النتيجة")}</th>
                      <th className="text-start font-medium px-3 py-1.5">{t("Spec", "المواصفة")}</th>
                      <th className="text-end font-medium px-3 py-1.5">{t("vs Target", "عن الهدف")}</th>
                      <th className="text-start font-medium px-3 py-1.5">{t("Status", "الحالة")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewSample.results.map((r, i) => (
                      <tr key={`${r.parameterId}-${i}`}>
                        <td className="px-3 py-1.5">
                          <p className="font-medium">{r.parameterName}</p>
                          <p className="text-xs text-slate-400">{LAB_OPERATOR_LABELS[r.operator][lang]}</p>
                        </td>
                        <td className="px-3 py-1.5 text-end font-medium whitespace-nowrap">
                          {r.value}{r.unit ? ` ${r.unit}` : ""}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">
                          {r.min ?? "–"} – {r.max ?? "–"}
                          {r.target != null && <span className="text-sky-600"> · ⌖{r.target}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-end text-xs whitespace-nowrap">
                          {r.deviation != null ? (
                            <span className={Math.abs(r.deviation) > 0.1 ? "text-amber-600 font-medium" : "text-slate-500"}>
                              {r.deviation >= 0 ? "+" : ""}{(r.deviation * 100).toFixed(1)}%
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5"><QcStatusBadge status={r.status} size="xs" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {viewSample.attachments?.length > 0 && (
                <div>
                  <Label className="text-xs text-slate-500">{t("Attachments", "المرفقات")}</Label>
                  <div className="mt-1 space-y-1">
                    {viewSample.attachments.map((a) => (
                      <a key={a._id} href={a.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sky-600 hover:underline text-xs bg-slate-50 rounded px-2 py-1.5">
                        <Paperclip size={12} className="shrink-0" /><span className="truncate">{a.fileName}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {viewSample.notes && (
                <div>
                  <Label className="text-xs text-slate-500">{t("Notes", "ملاحظات")}</Label>
                  <p className="mt-1 p-3 bg-slate-50 rounded-lg whitespace-pre-wrap">{viewSample.notes}</p>
                </div>
              )}

              {viewSample.finalDecision !== "pending" && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-amber-700">{t("Final Decision", "القرار النهائي")}</Label>
                    <DecisionBadge decision={viewSample.finalDecision} />
                  </div>
                  {viewSample.finalDecisionByName && (
                    <p className="text-xs text-amber-700">
                      {t("By", "بواسطة")} {viewSample.finalDecisionByName}
                      {viewSample.finalDecisionAt && ` · ${formatDate(viewSample.finalDecisionAt)}`}
                    </p>
                  )}
                  {viewSample.finalDecisionNote && (
                    <p className="text-sm text-amber-900 whitespace-pre-wrap">{viewSample.finalDecisionNote}</p>
                  )}
                </div>
              )}

              {canRecord && (
                <div className="flex justify-end pt-1">
                  <Button size="sm" variant="outline" onClick={() => {
                    setViewSample(null); setEditing(viewSample); setDialogOpen(true);
                  }}>
                    <Pencil size={13} className="me-1.5" />{t("Edit", "تعديل")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {tab === "specs" && (
        <ProductSpecsTab
          products={products}
          parameters={parameters}
          onProductsChanged={loadProducts}
          onParametersChanged={loadParameters}
        />
      )}

      {tab === "customers" && (
        <CustomersTab onChanged={loadCustomers} onOpen={(id) => router.push(`/customers/${id}`)} />
      )}

      {tab === "kpi" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              triggerClassName={SELECT_CLASS + " w-44"}
              value={product}
              onChange={(v) => { setProduct(v); setPage(1); }}
              options={[
                { value: "all", label: t("All products", "كل الأصناف") },
                ...products.map((p) => ({ value: p._id, label: p.name })),
              ]}
            />
            <Combobox
              triggerClassName={SELECT_CLASS + " w-44"}
              value={customer}
              onChange={(v) => { setCustomer(v); setPage(1); }}
              options={[
                { value: "all", label: t("All customers", "كل الزبائن") },
                ...customers.map((c) => ({ value: c._id, label: c.name })),
              ]}
            />
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          {/* Same shared product/customer/shift/date state the Results tab
              uses — switching tabs doesn't lose the filter picks, and a shift
              picked on Results silently carries into the KPI numbers too,
              same as GWMC. */}
          <KpiPanel filters={{ product, customer, shift, from, to }} />
        </div>
      )}
    </div>
  );
}
