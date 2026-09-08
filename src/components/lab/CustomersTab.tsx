"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Search, Users2, Pencil, Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useLang } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/utils";

interface CustomerRow {
  _id: string;
  isActive?: boolean;
  address?: string;
  name: string;
  nameAr?: string;
  code?: string;
  phone?: string;
  contactName?: string;
  sampleCount?: number;
  lastSampleDate?: string | null;
  passCount?: number;
  warningCount?: number;
  failCount?: number;
  inSpecPct?: number | null;
}

const EMPTY = { name: "", nameAr: "", code: "", phone: "", contactName: "", address: "" };

export function CustomersTab({ onChanged, onOpen }: { onChanged?: () => void; onOpen?: (id: string) => void }) {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  // Mirrors the API's own guard on POST/PUT/DELETE /api/customers — the GM
  // was added 2026-09-07 at the client's request, alongside the sales manager
  // who owns the register day to day.
  const canManage = role === "admin" || role === "sales_manager" || role === "general_manager";

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rowError, setRowError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ withStats: "true", page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    if (showArchived) params.set("includeInactive", "true");
    try {
      const res = await fetch(`/api/customers?${params}`);
      const data = await res.json();
      setRows(data.customers || []);
      setTotal(data.total ?? 0);
    } catch {
      setRows([]); setTotal(0);
    }
    setLoading(false);
  }, [search, showArchived, page, limit]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditingId(null); setForm({ ...EMPTY }); setError(""); setOpen(true); };

  const openEdit = (c: CustomerRow) => {
    setEditingId(c._id);
    setForm({
      name: c.name, nameAr: c.nameAr ?? "", code: c.code ?? "",
      phone: c.phone ?? "", contactName: c.contactName ?? "", address: c.address ?? "",
    });
    setError("");
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(editingId ? `/api/customers/${editingId}` : "/api/customers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // A 409 here is the deduplication rule doing its job — show the existing
        // name rather than a generic failure.
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setSaving(false);
        return;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY });
    load();
    onChanged?.();
  };

  /**
   * Archive, not delete.
   *
   * Orders and lab samples carry a `customerId`; removing the row would leave
   * a year of tonnage and QC history pointing at nothing. `isActive: false`
   * takes the customer out of every picker while every past record keeps its
   * name. The button says "archive" because that is what it does.
   */
  const setActive = async (c: CustomerRow, isActive: boolean) => {
    setRowError("");
    const res = isActive
      ? await fetch(`/api/customers/${c._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        })
      : await fetch(`/api/customers/${c._id}`, { method: "DELETE" });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setRowError((d as { error?: string }).error || `Error ${res.status}`);
      return;
    }
    load();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("Name or code", "الاسم أو الكود")}
            className="h-9 w-64 ps-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => { setShowArchived(e.target.checked); setPage(1); }}
            className="w-4 h-4 accent-sky-600 cursor-pointer"
          />
          {t("Show archived", "إظهار المؤرشفين")}
        </label>
        {canManage && (
          <Button className="ms-auto gap-1.5" size="sm" onClick={openNew}>
            <Plus size={14} />
            {t("New customer", "زبون جديد")}
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="text-start font-medium px-4 py-2.5">{t("Customer", "الزبون")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Contact", "جهة الاتصال")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Samples", "العيّنات")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Last sample", "آخر عيّنة")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("In spec", "نسبة المطابقة")}</th>
              {canManage && <th className="px-3 py-2.5 w-20" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-slate-400">{t("Loading…", "جارٍ التحميل…")}</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-12 text-center">
                  <Users2 size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-slate-500">
                    {search
                      ? t("No customer matches that.", "لا يوجد زبون مطابق.")
                      : t("No customers yet.", "لا يوجد زبائن بعد.")}
                  </p>
                </td>
              </tr>
            ) : rows.map((c) => (
              <tr
                key={c._id}
                onClick={onOpen ? () => onOpen(c._id) : undefined}
                className={
                  "hover:bg-slate-50/60" +
                  (onOpen ? " cursor-pointer" : "") +
                  (c.isActive === false ? " bg-slate-50/70" : "")
                }
              >
                <td className="px-4 py-2.5">
                  <div className={c.isActive === false ? "text-slate-500" : "text-slate-900"}>
                    {(lang === "ar" && c.nameAr) || c.name}
                    {c.isActive === false && (
                      <span className="ms-2 text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                        {t("archived", "مؤرشف")}
                      </span>
                    )}
                  </div>
                  {c.code && <span className="text-xs text-slate-400 font-mono">{c.code}</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  <div>{c.contactName || "—"}</div>
                  {c.phone && <bdi className="text-xs text-slate-400 block">{c.phone}</bdi>}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-slate-700">{c.sampleCount ?? 0}</td>
                <td className="px-3 py-2.5">
                  <bdi className="text-slate-600">
                    {c.lastSampleDate ? formatDate(c.lastSampleDate) : "—"}
                  </bdi>
                </td>
                <td className="px-3 py-2.5">
                  {c.inSpecPct == null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-800">{c.inSpecPct}%</span>
                      {/* A bar rather than only a number: the eye compares lengths
                          faster than it compares digits across rows. */}
                      <span className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
                        <span
                          className={
                            "block h-full rounded-full " +
                            (c.inSpecPct >= 95 ? "bg-emerald-500" : c.inSpecPct >= 85 ? "bg-amber-500" : "bg-red-500")
                          }
                          style={{ width: `${Math.max(2, c.inSpecPct)}%` }}
                        />
                      </span>
                      {(c.failCount ?? 0) > 0 && (
                        <span className="text-xs text-red-600 tabular-nums">
                          {c.failCount} {t("failed", "فشل")}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      {c.isActive === false ? (
                        <button
                          onClick={() => setActive(c, true)}
                          title={t("Restore", "استعادة")}
                          aria-label={t("Restore", "استعادة")}
                          className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                        >
                          <RotateCcw size={15} />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => openEdit(c)}
                            title={t("Edit", "تعديل")}
                            aria-label={t("Edit", "تعديل")}
                            className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => setActive(c, false)}
                            title={t("Archive", "أرشفة")}
                            aria-label={t("Archive", "أرشفة")}
                            className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                          >
                            <Archive size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rowError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{rowError}</p>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Previous", "السابق")}
          </button>
          <span className="text-sm text-slate-500 tabular-nums">
            <bdi>{page} / {Math.max(1, Math.ceil(total / limit))}</bdi>
            <span className="text-slate-300 mx-1.5">·</span>
            <bdi>{total}</bdi> {t("customers", "زبون")}
          </span>
          <button
            disabled={page >= Math.ceil(total / limit)}
            onClick={() => setPage((p) => p + 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Next", "التالي")}
          </button>
        </div>
      )}

      <p className="text-xs text-slate-400">
        {t(
          "Warnings count as in spec — they are inside the accepted range, just close to a limit.",
          "التحذيرات محسوبة ضمن المطابق — فهي داخل النطاق المقبول، لكنها قريبة من الحد."
        )}
      </p>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("Edit customer", "تعديل زبون") : t("New customer", "زبون جديد")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Name", "الاسم")} *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Arabic name", "الاسم بالعربية")}</Label>
                <Input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Code", "الكود")}</Label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Phone", "الهاتف")}</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Contact person", "جهة الاتصال")}</Label>
                <Input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("Cancel", "إلغاء")}</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving
                ? t("Saving…", "جارٍ الحفظ…")
                : editingId ? t("Save changes", "حفظ التعديلات") : t("Create", "إنشاء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
