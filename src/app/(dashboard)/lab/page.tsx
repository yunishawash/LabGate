"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { FlaskConical, Plus, Paperclip, Search, X, Download } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { DecisionBadge } from "@/components/ui/decision-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { SampleDialog } from "@/components/lab/SampleDialog";
import { ProductSpecsTab } from "@/components/lab/ProductSpecsTab";
import { CustomersTab } from "@/components/lab/CustomersTab";
import { KpiPanel } from "@/components/lab/KpiPanel";
import { formatDate, toDateInputValue } from "@/lib/utils";
import {
  LAB_SHIFT_LABELS,
  type ILabSample, type ILabProduct, type ILabCustomer, type LabShift,
} from "@/types";

type Tab = "results" | "specs" | "customers" | "kpi";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

export default function LabPage() {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const canRecord = role === "admin" || role === "lab_technician" || role === "technical_manager";

  const [tab, setTab] = useState<Tab>("results");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ILabSample | null>(null);

  // Filters live in component state, not the URL — the house convention.
  const [samples, setSamples] = useState<ILabSample[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [customers, setCustomers] = useState<ILabCustomer[]>([]);

  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [status, setStatus] = useState("all");
  const [shift, setShift] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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

  useEffect(() => { loadProducts(); loadCustomers(); }, [loadProducts, loadCustomers]);

  const fetchSamples = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    if (product !== "all") params.set("product", product);
    if (customer !== "all") params.set("customer", customer);
    if (status !== "all") params.set("status", status);
    if (shift !== "all") params.set("shift", shift);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    try {
      const res = await fetch(`/api/lab/samples?${params}`);
      const data = await res.json();
      setSamples(data.samples || []);
      setTotal(data.total || 0);
    } catch {
      setSamples([]); setTotal(0);
    }
    setLoading(false);
  }, [page, limit, search, product, customer, status, shift, from, to]);

  useEffect(() => { fetchSamples(); }, [fetchSamples]);

  // Same GET-navigation pattern as the Reports page: `assign()` rather than
  // `location.href` (the React Compiler rejects writing to a global), and the
  // response is Content-Disposition: attachment, so it downloads without
  // leaving the page. Always matches whatever the Results tab has on screen.
  const downloadLab = () => {
    const p = new URLSearchParams({ type: "lab", lang });
    if (search) p.set("search", search);
    if (product !== "all") p.set("product", product);
    if (customer !== "all") p.set("customer", customer);
    if (status !== "all") p.set("status", status);
    if (shift !== "all") p.set("shift", shift);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
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

          <DataTable<ILabSample>
            columns={columns}
            data={samples}
            total={total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
            loading={loading}
            onRowClick={canRecord ? (s) => { setEditing(s); setDialogOpen(true); } : undefined}
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
        onSaved={fetchSamples}
        products={products}
        customers={customers}
        editing={editing}
      />

      {tab === "specs" && (
        <ProductSpecsTab products={products} onProductsChanged={loadProducts} />
      )}

      {tab === "customers" && <CustomersTab onChanged={loadCustomers} />}

      {tab === "kpi" && <LabKpiTab products={products} />}
    </div>
  );
}

/**
 * Owns the product/date filter bar that used to live inside `KpiPanel`
 * itself — pulled out so the same panel can be embedded in a customer's
 * quality profile driven by a DIFFERENT filter bar (see KpiPanel.tsx).
 */
function LabKpiTab({ products }: { products: ILabProduct[] }) {
  const { t } = useLang();
  const [product, setProduct] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          triggerClassName={SELECT_CLASS + " w-44"}
          value={product}
          onChange={setProduct}
          options={[
            { value: "all", label: t("All products", "كل الأصناف") },
            ...products.map((p) => ({ value: p._id, label: p.name })),
          ]}
        />
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
      </div>
      <KpiPanel filters={{ product, from, to }} />
    </div>
  );
}
