"use client";
import { useCallback, useEffect, useState } from "react";
import { Settings2, Plus, Pencil, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import type { IRejectionReason } from "@/types";

const EMPTY = { label: "", labelAr: "", order: "0" };

/**
 * System settings — administrator only.
 *
 * The route gate does the enforcing: `settings` is a restricted module that
 * nobody can be granted (`UNGRANTABLE_MODULES`), so only the `admin` bypass
 * opens it. Every write below is re-checked with `requireRole("admin")`
 * server-side regardless, because a hidden page is not a permission.
 *
 * Holds the rejection-reason list today. It is a page rather than a tab on the
 * Lab or Users screen because it is neither: the list governs the approval
 * chain, and it is the only thing in the system the client asked to be locked
 * to the administrator specifically.
 */
export default function SettingsPage() {
  const { lang, t } = useLang();

  const [reasons, setReasons] = useState<IRejectionReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add AND edit share one dialog — `editing` set means edit.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IRejectionReason | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rejection-reasons");
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
      } else {
        setError("");
        const d = await res.json();
        setReasons(d.reasons || []);
      }
    } catch {
      setError(t("Could not reach the server.", "تعذّر الوصول إلى الخادم."));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY, order: String(reasons.length + 1) });
    setFormError("");
    setOpen(true);
  };

  const openEdit = (r: IRejectionReason) => {
    setEditing(r);
    setForm({ label: r.label, labelAr: r.labelAr ?? "", order: String(r.order ?? 0) });
    setFormError("");
    setOpen(true);
  };

  const save = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch(
        editing ? `/api/rejection-reasons/${editing._id}` : "/api/rejection-reasons",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.label.trim(),
            labelAr: form.labelAr.trim(),
            order: parseInt(form.order, 10) || 0,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFormError((d as { error?: string }).error || `Error ${res.status}`);
        setSaving(false);
        return;
      }
    } catch {
      setFormError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    setEditing(null);
    load();
  };

  /**
   * Retire, not delete. Orders already rejected under a reason keep the label
   * they were killed with, so retiring one only stops it being offered — and
   * the server refuses to retire the last remaining reason, since the
   * Technical Manager must have something to choose from.
   */
  const retire = async (r: IRejectionReason) => {
    if (!confirm(t(
      `Retire "${r.label}"? It stops being offered. Orders already rejected under it keep this reason.`,
      `إخفاء "${r.labelAr || r.label}"؟ لن يعود متاحًا للاختيار. والطلبيات المرفوضة به تحتفظ بهذا السبب.`
    ))) return;

    const res = await fetch(`/api/rejection-reasons/${r._id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert((d as { error?: string }).error || `Error ${res.status}`);
      return;
    }
    const d = await res.json().catch(() => ({ usedBy: 0 }));
    if ((d as { usedBy?: number }).usedBy) {
      alert(t(
        `Retired. ${(d as { usedBy: number }).usedBy} rejected order(s) still show this reason.`,
        `تم الإخفاء. ولا تزال ${(d as { usedBy: number }).usedBy} طلبية مرفوضة تُظهر هذا السبب.`
      ));
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <Settings2 size={22} className="text-slate-500" />
          {t("Settings", "إعدادات النظام")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            "Lists that govern how the approval chain behaves. Administrator only.",
            "القوائم التي تحكم سلوك سلسلة الاعتماد. لمدير النظام فقط."
          )}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
          <div>
            <h2 className="font-medium text-slate-900 flex items-center gap-2">
              <XCircle size={17} className="text-red-500" />
              {t("Rejection reasons", "أسباب الرفض")}
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              {t(
                "The Technical Manager must pick one of these to reject an order, and may add a note. Every other role writes its own reason freely — a finance or management rejection can be about anything, where his are a small closed set about the plant's ability to supply.",
                "يجب على المدير التقني اختيار أحد هذه الأسباب لرفض الطلبية، وله أن يضيف ملاحظة. أمّا بقية الأدوار فتكتب سببها بحرّية — فرفض الإدارة أو المالية قد يكون لأي سبب، بينما أسباب المدير التقني مجموعة محدودة تتعلّق بقدرة المصنع على التوريد."
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={openAdd}>
            <Plus size={14} />
            {t("New reason", "سبب جديد")}
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 p-6 text-center">{t("Loading…", "جارٍ التحميل…")}</p>
        ) : reasons.length === 0 ? (
          <div className="p-6 flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">
                {t("No rejection reasons configured.", "لا توجد أسباب رفض معرَّفة.")}
              </p>
              <p className="text-slate-500 mt-0.5">
                {t(
                  "Until one exists, the Technical Manager cannot reject an order at all.",
                  "إلى أن يوجد سبب واحد على الأقل، لا يستطيع المدير التقني رفض أي طلبية."
                )}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reasons.map((r) => (
              <li key={r._id} className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs text-slate-300 w-6 tabular-nums">{r.order}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 truncate">
                    <bdi>{(lang === "ar" && r.labelAr) || r.label}</bdi>
                  </p>
                  {/* The other language, so an administrator can see both
                      labels without switching the whole interface. */}
                  {r.labelAr && r.label && (
                    <p className="text-xs text-slate-400 truncate">
                      <bdi>{lang === "ar" ? r.label : r.labelAr}</bdi>
                    </p>
                  )}
                </div>
                <button
                  onClick={() => openEdit(r)}
                  className="text-xs text-sky-600 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Pencil size={12} />
                  {t("Edit", "تعديل")}
                </button>
                <button
                  onClick={() => retire(r)}
                  className="text-xs text-red-500 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  {t("Retire", "إخفاء")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("Edit reason", "تعديل السبب") : t("New rejection reason", "سبب رفض جديد")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Label (English)", "التسمية بالإنجليزية")} *</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Stock not available"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Label (Arabic)", "التسمية بالعربية")}</Label>
              <Input
                value={form.labelAr}
                onChange={(e) => setForm((f) => ({ ...f, labelAr: e.target.value }))}
                placeholder="مثال: عدم توفر البضاعة"
              />
              <p className="text-xs text-slate-400">
                {t(
                  "This is what the Technical Manager sees and what the order records.",
                  "هذه هي التسمية التي يراها المدير التقني وتُسجَّل على الطلبية."
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Display order", "ترتيب العرض")}</Label>
              <Input
                type="number"
                value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
              />
            </div>

            {editing && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t(
                  "Rewording this does not change orders already rejected under it — they keep the wording they were rejected with.",
                  "إعادة صياغة السبب لا تغيّر الطلبيات المرفوضة به سابقًا — فهي تحتفظ بالصياغة التي رُفضت بها."
                )}
              </p>
            )}

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setOpen(false); setEditing(null); }}
              disabled={saving}
            >
              {t("Cancel", "إلغاء")}
            </Button>
            <Button onClick={save} disabled={saving || !form.label.trim()}>
              {saving ? t("Saving…", "جارٍ الحفظ…") : editing ? t("Save", "حفظ") : t("Create", "إنشاء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
