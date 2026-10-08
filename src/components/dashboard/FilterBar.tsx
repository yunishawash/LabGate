"use client";
import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Combobox } from "@/components/ui/combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { productPickerOptions } from "@/types";
import type { ILabCustomer, ILabProduct, ICity } from "@/types";

export interface DashboardFilters {
  from: string;
  to: string;
  customerId: string;
  productId: string;
  cityId: string;
}

export const EMPTY_FILTERS: DashboardFilters = { from: "", to: "", customerId: "", productId: "", cityId: "" };

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
  const [cities, setCities] = useState<ICity[]>([]);

  useEffect(() => {
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    fetch("/api/cities").then((r) => r.json()).then((d) => setCities(d.cities || [])).catch(() => {});
  }, []);

  const set = (patch: Partial<DashboardFilters>) => onChange({ ...value, ...patch });
  const active = !!(value.from || value.to || value.customerId || value.productId || value.cityId);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-slate-900 flex items-center gap-1.5 flex-shrink-0">
        <Filter size={15} className="text-slate-500" />
        {t("Filter", "تصفية")}
      </span>

      {/* Same calendar-grid range picker the Reports page uses, not two bare
          date inputs — one control for "from–to", consistent across the two
          places in the app that filter by a date range. */}
      <DateRangePicker from={value.from} to={value.to} onChange={(from, to) => set({ from, to })} />

      <Combobox
        triggerClassName={SELECT_CLASS + " w-44"}
        value={value.productId}
        onChange={(v) => set({ productId: v })}
        placeholder={t("All products", "كل الأصناف")}
        searchPlaceholder={t("Search products…", "ابحث عن صنف…")}
        options={[
          { value: "", label: t("All products", "كل الأصناف") },
          ...productPickerOptions(products, lang),
        ]}
      />

      <Combobox
        triggerClassName={SELECT_CLASS + " w-48"}
        value={value.customerId}
        // Picking a customer narrows past "which city" — it IS one, so the
        // city filter is cleared rather than left sitting unused beside it.
        onChange={(v) => set({ customerId: v, cityId: v ? "" : value.cityId })}
        placeholder={t("All customers", "كل الزبائن")}
        searchPlaceholder={t("Search customers…", "ابحث عن زبون…")}
        options={[
          { value: "", label: t("All customers", "كل الزبائن") },
          ...customers.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name })),
        ]}
      />

      <Combobox
        triggerClassName={SELECT_CLASS + " w-40"}
        value={value.cityId}
        onChange={(v) => set({ cityId: v, customerId: v ? "" : value.customerId })}
        placeholder={t("All cities", "كل المدن")}
        searchPlaceholder={t("Search cities…", "ابحث عن مدينة…")}
        options={[
          { value: "", label: t("All cities", "كل المدن") },
          ...cities.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name })),
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
