"use client";
import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { toDateInputValue } from "@/lib/utils";
import type { ILabCustomer, ILabProduct } from "@/types";

export interface DashboardFilters {
  from: string;
  to: string;
  customerId: string;
  productId: string;
}

export const EMPTY_FILTERS: DashboardFilters = { from: "", to: "", customerId: "", productId: "" };

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * The one filter bar that scopes every chart and reporting widget below it
 * (see the layout note in dashboard/page.tsx for exactly which blocks read
 * it and which deliberately don't — the "waiting on you" queues ignore it by
 * design, since a historical date range contradicts "what needs me now").
 */
export function DashboardFilterBar({
  value, onChange,
}: {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}) {
  const { lang, t } = useLang();
  const [customers, setCustomers] = useState<ILabCustomer[]>([]);
  const [products, setProducts] = useState<ILabProduct[]>([]);

  useEffect(() => {
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
  }, []);

  const set = (patch: Partial<DashboardFilters>) => onChange({ ...value, ...patch });
  const active = !!(value.from || value.to || value.customerId || value.productId);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-slate-900 flex items-center gap-1.5 flex-shrink-0">
        <Filter size={15} className="text-slate-500" />
        {t("Filter", "تصفية")}
      </span>

      <div className="flex items-center gap-1.5">
        <Input
          type="date" value={value.from} max={value.to || toDateInputValue(new Date())}
          onChange={(e) => set({ from: e.target.value })}
          className="h-9 w-36"
          title={t("From", "من")}
        />
        <span className="text-slate-300 text-sm">–</span>
        <Input
          type="date" value={value.to} min={value.from || undefined} max={toDateInputValue(new Date())}
          onChange={(e) => set({ to: e.target.value })}
          className="h-9 w-36"
          title={t("To", "إلى")}
        />
      </div>

      <Combobox
        triggerClassName={SELECT_CLASS + " w-44"}
        value={value.productId}
        onChange={(v) => set({ productId: v })}
        placeholder={t("All products", "كل الأصناف")}
        searchPlaceholder={t("Search products…", "ابحث عن صنف…")}
        options={[
          { value: "", label: t("All products", "كل الأصناف") },
          ...products.map((p) => ({ value: p._id, label: (lang === "ar" && p.nameAr) || p.name })),
        ]}
      />

      <Combobox
        triggerClassName={SELECT_CLASS + " w-48"}
        value={value.customerId}
        onChange={(v) => set({ customerId: v })}
        placeholder={t("All customers", "كل الزبائن")}
        searchPlaceholder={t("Search customers…", "ابحث عن زبون…")}
        options={[
          { value: "", label: t("All customers", "كل الزبائن") },
          ...customers.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name })),
        ]}
      />

      {active && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer ms-auto"
        >
          <X size={13} />
          {t("Reset", "إعادة تعيين")}
        </button>
      )}
    </div>
  );
}
