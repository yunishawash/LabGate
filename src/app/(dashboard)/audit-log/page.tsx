"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScrollText, Search, X } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { formatDateTime, toDateInputValue } from "@/lib/utils";
import { SALES_STAGES } from "@/lib/salesWorkflow";

interface Entry {
  _id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  field: string;
  oldValue: string;
  newValue: string;
  performedByName: string;
  notes: string;
  timestamp: string;
}

const SELECT =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

const ENTITY: Record<string, { en: string; ar: string }> = {
  sales_order: { en: "Order", ar: "طلبية" },
  delegation:  { en: "Delegation", ar: "تفويض" },
  user:        { en: "User", ar: "مستخدم" },
  lab_sample:  { en: "Lab sample", ar: "عيّنة" },
};

const ACTION: Record<string, { en: string; ar: string }> = {
  created:         { en: "Created", ar: "إنشاء" },
  updated:         { en: "Edited", ar: "تعديل" },
  stage_approved:  { en: "Stage approved", ar: "اعتماد مرحلة" },
  stage_rejected:  { en: "Rejected", ar: "رفض" },
  lab_attached:    { en: "Lab results attached", ar: "إرفاق نتائج" },
  weighed_posted:  { en: "Weighed and posted", ar: "وزن وترحيل" },
  role_changed:    { en: "Role changed", ar: "تغيير الدور" },
  password_reset:  { en: "Password reset", ar: "إعادة تعيين كلمة السر" },
  activated:       { en: "Activated", ar: "تفعيل" },
  deactivated:     { en: "Deactivated", ar: "تعطيل" },
  absence_set:     { en: "Marked away", ar: "تسجيل غياب" },
  absence_cleared: { en: "Back from away", ar: "رجوع من الغياب" },
  revoked:         { en: "Revoked", ar: "إلغاء" },
};

/** Actions that move authority. They are the reason this page exists. */
const AUTHORITY = new Set([
  "role_changed", "password_reset", "activated", "deactivated",
  "absence_set", "absence_cleared", "created", "revoked",
]);

export default function AuditLogPage() {
  const { lang, t } = useLang();
  const router = useRouter();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const has = !!search || entityType !== "all" || action !== "all" || !!from || !!to;
  const clear = () => { setSearch(""); setEntityType("all"); setAction("all"); setFrom(""); setTo(""); setPage(1); };

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (entityType !== "all") p.set("entityType", entityType);
    if (action !== "all") p.set("action", action);
    if (search) p.set("search", search);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    try {
      const res = await fetch(`/api/audit-log?${p}`);
      const d = await res.json();
      // A 403 body has no `entries` at all — `d.entries ?? []` would render
      // that identically to a genuinely empty trail. This is the exact bug a
      // permissions mismatch produced once already: the page looked fine and
      // quietly lied. `res.ok` is what tells the two cases apart.
      if (!res.ok) {
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setEntries([]); setActions([]); setTotal(0);
        setLoading(false);
        return;
      }
      setError("");
      setEntries(d.entries ?? []);
      setActions(d.actions ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setEntries([]);
    }
    setLoading(false);
  }, [page, entityType, action, search, from, to, t]);

  useEffect(() => { load(); }, [load]);

  const stageName = (key: string) => {
    const s = SALES_STAGES.find((x) => x.key === key);
    return s ? (lang === "ar" ? s.ar : s.en) : key;
  };

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <ScrollText size={22} className="text-slate-500" />
          {t("Audit Trail", "سجل التدقيق")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            "Every signature, every change of authority, and who made it.",
            "كل توقيع، وكل تغيير بالصلاحيات، ومين عمله."
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("Order, person or note", "طلبية أو شخص أو ملاحظة")}
            className="h-9 w-64 ps-8"
          />
        </div>
        <Combobox
          triggerClassName={SELECT + " w-40"}
          value={entityType}
          onChange={(v) => { setEntityType(v); setAction("all"); setPage(1); }}
          options={[
            { value: "all", label: t("Everything", "كل شيء") },
            ...Object.entries(ENTITY).map(([k, v]) => ({ value: k, label: v[lang] })),
          ]}
        />
        <Combobox
          triggerClassName={SELECT + " w-44"}
          value={action}
          onChange={(v) => { setAction(v); setPage(1); }}
          options={[
            { value: "all", label: t("All actions", "كل الإجراءات") },
            ...actions.map((a) => ({ value: a, label: ACTION[a]?.[lang] ?? a })),
          ]}
        />
        <Input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-40" />
        <Input type="date" value={to} min={from || undefined} max={toDateInputValue(new Date())} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-40" />
        {has && (
          <button onClick={clear} className="h-9 px-3 rounded-lg text-sm text-slate-500 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5">
            <X size={14} />
            {t("Clear", "مسح")}
          </button>
        )}
        <span className="text-xs text-slate-400 ms-auto tabular-nums">
          <bdi>{total}</bdi> {t("entries", "مدخلة")}
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <p className="p-4 text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
        {!loading && !error && !entries.length && (
          <p className="p-6 text-sm text-slate-400 text-center">
            {t("Nothing matches these filters.", "لا يوجد شيء مطابق.")}
          </p>
        )}
        {entries.map((e) => {
          const authority = AUTHORITY.has(e.action) && e.entityType !== "sales_order";
          return (
            <div
              key={e._id}
              onClick={() => e.entityType === "sales_order" && router.push(`/orders/${e.entityId}`)}
              className={
                "p-3 flex items-start gap-3 " +
                (e.entityType === "sales_order" ? "cursor-pointer hover:bg-slate-50" : "")
              }
            >
              <bdi className="text-xs text-slate-400 whitespace-nowrap pt-0.5 min-w-36 tabular-nums">
                {formatDateTime(e.timestamp)}
              </bdi>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {ENTITY[e.entityType]?.[lang] ?? e.entityType}
                  </span>
                  {/* An authority change is the one thing on this page that
                      someone might come looking for months later. */}
                  <span className={authority ? "font-medium text-amber-800" : ""}>
                    {ACTION[e.action]?.[lang] ?? e.action}
                  </span>
                  {e.entityLabel && <bdi className="font-mono text-xs text-sky-700">{e.entityLabel}</bdi>}
                  {e.field && (
                    <span className="text-xs text-slate-400">
                      {e.entityType === "sales_order" ? stageName(e.field) : e.field}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {e.performedByName}
                  {(e.oldValue || e.newValue) && (
                    <span className="text-slate-400">
                      {" · "}
                      {e.oldValue || "—"} → {e.newValue || "—"}
                    </span>
                  )}
                  {e.notes && <span className="text-slate-500"> — {e.notes}</span>}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Previous", "السابق")}
          </button>
          <span className="text-sm text-slate-500 tabular-nums">
            <bdi>{page} / {pages}</bdi>
          </span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-50"
          >
            {t("Next", "التالي")}
          </button>
        </div>
      )}
    </div>
  );
}
