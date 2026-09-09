"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Paperclip, X, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { useLang } from "@/components/layout/AppShell";
import { evaluate, deviationFromTarget, rollUpStatus } from "@/lib/labQc";
import { toDateInputValue } from "@/lib/utils";
import {
  LAB_SHIFT_LABELS, LAB_DECISION_LABELS,
  type ILabProduct, type ILabCustomer, type ILabProductSpec,
  type ILabSample, type ILabAttachment, type LabStatus,
} from "@/types";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives the created/updated sample — used by the order flow (stage 6)
   *  to chain straight into attaching it, with no second click to find it in
   *  a list. The lab screen's own caller just ignores the argument. */
  onSaved: (saved?: ILabSample) => void;
  products: ILabProduct[];
  customers: ILabCustomer[];
  editing?: ILabSample | null;
  /** Prefill and lock fields when the sample is being recorded as stage 6 of an
   *  order's chain — the product and customer come from the order, not a guess. */
  prefill?: { productId?: string; customerId?: string; lockProduct?: boolean; lockCustomer?: boolean };
  /** Shown under the title — e.g. which order and which of its product lines
   *  this sample is being recorded for. An order with several lines needs
   *  that said out loud, or "New sample" alone doesn't say which one. */
  contextNote?: string;
}

/**
 * A value so far outside the spec that it is almost certainly a typo — a
 * slipped decimal point, usually. NOT a blocking rule: a genuinely disastrous
 * reading must still be recordable, because hiding it is worse than typing it.
 * It only asks "did you mean this?".
 */
function isImplausible(value: number, spec: ILabProductSpec): boolean {
  if (spec.max != null && value > spec.max * 10) return true;
  if (spec.min != null && spec.min > 0 && value < spec.min / 10) return true;
  return false;
}

export function SampleDialog({
  open, onClose, onSaved, products, customers, editing = null, prefill, contextNote,
}: Props) {
  const { lang, t } = useLang();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const canSignOff = role === "admin" || role === "technical_manager";

  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [sampleDate, setSampleDate] = useState(toDateInputValue(new Date()));
  const [shift, setShift] = useState("");
  const [batchId, setBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState("pending");
  const [decisionNote, setDecisionNote] = useState("");

  const [specs, setSpecs] = useState<ILabProductSpec[]>([]);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [existingAttachments, setExistingAttachments] = useState<ILabAttachment[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset whenever the dialog opens, so a previous entry never bleeds through.
  useEffect(() => {
    if (!open) return;
    setError("");
    setFiles([]);
    if (editing) {
      setProductId(editing.productId);
      setCustomerId(editing.customerId ?? "");
      setSampleDate(toDateInputValue(new Date(editing.sampleDate)));
      setShift(editing.shift ?? "");
      setBatchId(editing.batchId ?? "");
      setNotes(editing.notes ?? "");
      setDecision(editing.finalDecision ?? "pending");
      setDecisionNote(editing.finalDecisionNote ?? "");
      setValues(
        Object.fromEntries(editing.results.map((r) => [r.parameterId, String(r.value)]))
      );
      setExistingAttachments(editing.attachments ?? []);
    } else {
      setProductId(prefill?.productId ?? "");
      setCustomerId(prefill?.customerId ?? "");
      setSampleDate(toDateInputValue(new Date()));
      setShift(""); setBatchId(""); setNotes("");
      setDecision("pending"); setDecisionNote("");
      setValues({});
      setExistingAttachments([]);
    }
  }, [open, editing, prefill]);

  /** Best-effort — the sample's own attachment list is refreshed from the
   *  server's response the next time the dialog opens regardless, so a
   *  failed delete here just means the user retries, not a corrupted view. */
  const removeExistingAttachment = async (attachmentId?: string) => {
    if (!editing || !attachmentId) return;
    if (!window.confirm(t("Remove this file?", "إزالة هذا الملف؟"))) return;
    setExistingAttachments((prev) => prev.filter((a) => a._id !== attachmentId));
    await fetch(`/api/lab/samples/${editing._id}/attachments/${attachmentId}`, { method: "DELETE" });
  };

  // The spec sheet is per product — changing the product changes every limit.
  useEffect(() => {
    if (!productId) { setSpecs([]); return; }
    setSpecsLoading(true);
    fetch(`/api/lab/products/${productId}/specs`)
      .then((r) => r.json())
      .then((d) => setSpecs(d.specs || []))
      .catch(() => setSpecs([]))
      .finally(() => setSpecsLoading(false));
  }, [productId]);

  /**
   * Live preview, computed with the SAME pure functions the server scores with
   * (`src/lib/labQc.ts`), so what the technician sees while typing is what gets
   * stored. The server still re-scores on save and its answer wins — this is a
   * preview, never the source of truth.
   */
  const preview = specs.map((spec) => {
    const raw = values[spec.parameterId];
    const value = raw === "" || raw === undefined ? null : Number(raw);
    if (value === null || !Number.isFinite(value)) {
      return { spec, value: null, status: null as LabStatus | null, deviation: null };
    }
    return {
      spec,
      value,
      status: evaluate(value, spec.min, spec.max, spec.operator, spec.target),
      deviation: deviationFromTarget(value, spec.target),
    };
  });

  const entered = preview.filter((p) => p.value !== null);
  const overall = entered.length
    ? rollUpStatus(entered.map((p) => p.status as LabStatus))
    : null;
  const counts = {
    pass: entered.filter((p) => p.status === "pass").length,
    warning: entered.filter((p) => p.status === "warning").length,
    fail: entered.filter((p) => p.status === "fail").length,
  };

  // Shown persistently while the form is open, not just sprung as a confirm()
  // at save time — a technician should see the "is this a typo?" flag as soon
  // as they type it, not after they've already reached for Save.
  const implausible = entered.filter((p) => isImplausible(p.value as number, p.spec));

  const handleSave = useCallback(async () => {
    if (!productId) { setError(t("Choose a product.", "اختر الصنف.")); return; }
    if (!entered.length) {
      setError(t("Enter at least one reading.", "أدخل قراءة واحدة على الأقل."));
      return;
    }

    // Non-blocking: an out-of-spec reading is exactly what this system exists to
    // record. Only ask about values that look like a typing slip.
    if (implausible.length) {
      const list = implausible.map((p) => `${p.spec.name} = ${p.value}`).join("\n");
      const ok = window.confirm(
        t(
          `These readings look far outside the usual range — a mistyped decimal?\n\n${list}\n\nSave them as entered?`,
          `هذه القراءات بعيدة جداً عن المعتاد — هل هو خطأ في الفاصلة العشرية؟\n\n${list}\n\nنحفظها كما هي؟`
        )
      );
      if (!ok) return;
    }

    setSaving(true);
    setError("");

    const payload = {
      productId,
      customerId: customerId || null,
      sampleDate,
      shift,
      batchId,
      notes,
      results: entered.map((p) => ({ parameterId: p.spec.parameterId, value: p.value })),
      ...(canSignOff ? { finalDecision: decision, finalDecisionNote: decisionNote } : {}),
    };

    // Declared outside the try block so it still exists at the `onSaved` call
    // below — a caller chaining off the created sample's id (the order flow)
    // needs it, not just the fact that saving succeeded.
    let saved: ILabSample | undefined;

    try {
      const res = await fetch(
        editing ? `/api/lab/samples/${editing._id}` : "/api/lab/samples",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Error ${res.status}`);
        setSaving(false);
        return;
      }

      // Attachments are staged in the browser and uploaded only after the
      // sample exists — they need its id for their folder.
      saved = await res.json();
      if (files.length) {
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        await fetch(`/api/lab/samples/${saved!._id}/attachments`, { method: "POST", body: form });
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved(saved);
    onClose();
  }, [
    productId, customerId, sampleDate, shift, batchId, notes, entered, implausible, files,
    editing, decision, decisionNote, canSignOff, onSaved, onClose, t,
  ]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("Edit sample", "تعديل العيّنة") : t("New sample", "عيّنة جديدة")}
            {editing && <span className="ms-2 font-mono text-sm text-slate-400">{editing.sampleNumber}</span>}
          </DialogTitle>
        </DialogHeader>

        {contextNote && (
          <p className="text-sm text-slate-500 -mt-2">{contextNote}</p>
        )}

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Product", "الصنف")} *</Label>
              <Combobox
                triggerClassName={SELECT_CLASS}
                value={productId}
                disabled={prefill?.lockProduct}
                onChange={setProductId}
                placeholder={t("Choose…", "اختر…")}
                options={[
                  { value: "", label: t("Choose…", "اختر…") },
                  ...products.map((p) => ({ value: p._id, label: p.name })),
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Customer", "الزبون")}</Label>
              {/* Select-only, never create-on-typing: a customer row now carries
                  tonnage and approvals, so a near-duplicate splits real reports. */}
              <Combobox
                triggerClassName={SELECT_CLASS}
                value={customerId}
                disabled={prefill?.lockCustomer}
                onChange={setCustomerId}
                placeholder={t("None", "بدون")}
                options={[
                  { value: "", label: t("None", "بدون") },
                  ...customers.map((c) => ({ value: c._id, label: c.name })),
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Sample date", "تاريخ العيّنة")} *</Label>
              <Input type="date" value={sampleDate} max={toDateInputValue(new Date())}
                onChange={(e) => setSampleDate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Shift", "الوردية")}</Label>
              <Combobox
                triggerClassName={SELECT_CLASS}
                value={shift}
                onChange={setShift}
                placeholder={t("Not stated", "غير محدَّد")}
                options={[
                  { value: "", label: t("Not stated", "غير محدَّد") },
                  ...(["morning", "afternoon", "night"] as const).map((s) => ({ value: s, label: LAB_SHIFT_LABELS[s][lang] })),
                ]}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Batch / lot", "رقم الدفعة")}</Label>
              <Input value={batchId} onChange={(e) => setBatchId(e.target.value)}
                placeholder={t("The physical lot this sample came from", "الدفعة الفعلية التي أُخذت منها العيّنة")} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{t("Readings", "القراءات")}</Label>
              {overall && (
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {counts.pass} {t("ok", "مطابق")} · {counts.warning} {t("warning", "تحذير")} · {counts.fail} {t("out of range", "خارج النطاق")}
                  {t("Live verdict", "الحكم اللحظي")}
                  <QcStatusBadge status={overall} />
                </span>
              )}
            </div>

            {!productId ? (
              <p className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-4 text-center">
                {t("Choose a product to load its specification.", "اختر صنفاً لتحميل مواصفاته.")}
              </p>
            ) : specsLoading ? (
              <p className="text-sm text-slate-400 p-4 text-center">{t("Loading…", "جارٍ التحميل…")}</p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                {preview.map(({ spec, value, status, deviation }) => {
                  const isImplausibleValue = value !== null && isImplausible(value, spec);
                  return (
                    <div
                      key={spec.parameterId}
                      className={
                        "flex items-center gap-3 px-3 py-2 " +
                        (status === "fail" ? "bg-red-50/40" : status === "warning" ? "bg-amber-50/40" : "")
                      }
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-800 truncate">
                          {(lang === "ar" && spec.nameAr) || spec.name}
                          {spec.unit && <span className="text-slate-400"> ({spec.unit})</span>}
                        </div>
                        <bdi className="text-xs text-slate-400 block">
                          {spec.min != null && spec.max != null
                            ? `${spec.min} – ${spec.max}`
                            : spec.max != null ? `≤ ${spec.max}`
                            : spec.min != null ? `≥ ${spec.min}`
                            : t("no limit", "بدون حد")}
                          {spec.target != null && ` · ${t("target", "الهدف")} ${spec.target}`}
                        </bdi>
                      </div>
                      <Input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        className={
                          "w-28 h-9 text-end tabular-nums " +
                          (status === "fail" ? "border-red-400 focus-visible:ring-red-400"
                            : status === "warning" ? "border-amber-400 focus-visible:ring-amber-400"
                            : status === "pass" ? "border-green-400 focus-visible:ring-green-400" : "")
                        }
                        value={values[spec.parameterId] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [spec.parameterId]: e.target.value }))
                        }
                      />
                      <div className="w-28 flex justify-end">
                        {value !== null && status && (
                          <span className="flex items-center gap-1.5">
                            {deviation !== null && (
                              <bdi className="text-xs text-slate-400 tabular-nums">
                                {deviation > 0 ? "+" : ""}{(deviation * 100).toFixed(1)}%
                              </bdi>
                            )}
                            <QcStatusBadge status={status} size="xs" />
                            {isImplausibleValue && <AlertTriangle size={13} className="text-amber-500" />}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {implausible.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {t(
                  `${implausible.length} value(s) are far outside the normal range — double-check for a typo.`,
                  `${implausible.length} قيمة بعيدة جدًا عن النطاق الطبيعي — تأكد من عدم وجود خطأ إدخال.`
                )}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("Notes", "ملاحظات")}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Paperclip size={14} />
              {t("Attachments", "المرفقات")}
            </Label>
            <input
              type="file"
              multiple
              onChange={(e) => {
                // Accumulate rather than replace — picking files twice (once
                // now, once more after noticing you forgot one) shouldn't
                // silently drop the first batch. Reset the input's own value
                // so choosing the exact same file again still fires onChange.
                setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                e.target.value = "";
              }}
              className="block w-full text-sm text-slate-500 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white hover:file:bg-slate-50 file:cursor-pointer"
            />
            {(existingAttachments.length > 0 || files.length > 0) && (
              <ul className="text-xs space-y-1 pt-1">
                {existingAttachments.map((a) => (
                  <li key={a._id} className="flex items-center justify-between gap-2 bg-slate-50 rounded px-2 py-1.5">
                    <a href={a.url} target="_blank" rel="noopener noreferrer"
                      className="text-sky-600 hover:underline truncate flex items-center gap-1.5 min-w-0">
                      <Paperclip size={11} className="shrink-0" />
                      <span className="truncate">{a.fileName}</span>
                    </a>
                    <button type="button" onClick={() => removeExistingAttachment(a._id)}
                      className="text-red-500 hover:underline cursor-pointer shrink-0">
                      {t("Remove", "إزالة")}
                    </button>
                  </li>
                ))}
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-sky-50 rounded px-2 py-1.5">
                    <span className="text-slate-600 truncate flex items-center gap-1.5 min-w-0">
                      <Paperclip size={11} className="shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-slate-400 shrink-0">({t("not uploaded yet", "لم يُرفع بعد")})</span>
                    </span>
                    <button type="button" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:underline cursor-pointer shrink-0">
                      {t("Remove", "إزالة")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canSignOff && (
            <div className="border-t border-slate-100 pt-4 grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("Sign-off", "الاعتماد")}</Label>
                {/* Signs off on the SAMPLE. Stage 7 of an order's chain is a
                    different decision on a different object — never coupled. */}
                <Combobox
                  triggerClassName={SELECT_CLASS}
                  value={decision}
                  onChange={setDecision}
                  options={(["pending", "accepted", "rejected"] as const).map((d) => ({
                    value: d, label: LAB_DECISION_LABELS[d][lang],
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Sign-off note", "ملاحظة الاعتماد")}</Label>
                <Input value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X size={15} className="me-1.5" />
            {t("Cancel", "إلغاء")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !productId || !entered.length}>
            {saving ? t("Saving…", "جارٍ الحفظ…") : t("Save sample", "حفظ العيّنة")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
