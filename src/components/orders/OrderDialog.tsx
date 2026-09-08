"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";
import { toDateInputValue } from "@/lib/utils";
import { BAG_WEIGHTS, type ILabCustomer, type ILabProduct } from "@/types";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

interface Line { productId: string; bagWeightKg: number; bagCount: string; note: string }

const emptyLine = (): Line => ({ productId: "", bagWeightKg: 50, bagCount: "", note: "" });

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customers: ILabCustomer[];
  /** Editing is only possible before the first approval — the server re-checks. */
  editing?: {
    _id: string; customerId: string; referenceNo?: string; orderDate: string;
    deliveryDate?: string | null; notes?: string;
    lines: { productId: string; bagWeightKg: number; bagCount: number; note?: string }[];
  } | null;
}

export function OrderDialog({ open, onClose, onSaved, customers, editing = null }: Props) {
  const { lang, t } = useLang();

  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [orderDate, setOrderDate] = useState(toDateInputValue(new Date()));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    setError("");
    if (editing) {
      setCustomerId(editing.customerId);
      setReferenceNo(editing.referenceNo ?? "");
      setOrderDate(toDateInputValue(new Date(editing.orderDate)));
      setDeliveryDate(editing.deliveryDate ? toDateInputValue(new Date(editing.deliveryDate)) : "");
      setNotes(editing.notes ?? "");
      setLines(editing.lines.map((l) => ({
        productId: l.productId, bagWeightKg: l.bagWeightKg,
        bagCount: String(l.bagCount), note: l.note ?? "",
      })));
    } else {
      setCustomerId(""); setReferenceNo("");
      setOrderDate(toDateInputValue(new Date()));
      setDeliveryDate(""); setNotes("");
      setLines([emptyLine()]);
    }
  }, [open, editing]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // Mirrors what the server computes. The server's numbers are the ones stored —
  // this is only so the person sees the total while typing.
  const lineKg = (l: Line) => l.bagWeightKg * (parseInt(l.bagCount, 10) || 0);
  const totalBags = lines.reduce((n, l) => n + (parseInt(l.bagCount, 10) || 0), 0);
  const totalKg = lines.reduce((n, l) => n + lineKg(l), 0);

  const valid =
    !!customerId &&
    !!orderDate &&
    lines.length > 0 &&
    lines.every((l) => l.productId && (parseInt(l.bagCount, 10) || 0) >= 1);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError("");

    const payload = {
      customerId,
      referenceNo,
      orderDate,
      deliveryDate: deliveryDate || null,
      notes,
      lines: lines.map((l) => ({
        productId: l.productId,
        bagWeightKg: l.bagWeightKg,
        bagCount: parseInt(l.bagCount, 10),
        note: l.note,
      })),
    };

    try {
      const res = await fetch(editing ? `/api/orders/${editing._id}` : "/api/orders", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
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
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit order", "تعديل الطلبية") : t("New order", "طلبية جديدة")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Customer", "الزبون")} *</Label>
              {/* Select-only. Creating a customer is a separate, permissioned
                  action — a near-duplicate here splits real tonnage reports. */}
              <Combobox
                triggerClassName={SELECT_CLASS}
                value={customerId}
                onChange={setCustomerId}
                placeholder={t("Choose…", "اختر…")}
                searchPlaceholder={t("Search customers…", "ابحث عن زبون…")}
                options={customers.map((c) => ({ value: c._id, label: (lang === "ar" && c.nameAr) || c.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Reference No.", "الرقم المرجعي")}</Label>
              <Input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder={t("Your own number for this order", "رقمك الخاص لهذه الطلبية")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Order date", "تاريخ الطلبية")} *</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Delivery date", "تاريخ التسليم")}</Label>
              <Input type="date" value={deliveryDate} min={orderDate}
                onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{t("Lines", "البنود")}</Label>
              <span className="text-xs text-slate-500">
                <bdi className="tabular-nums font-medium text-slate-800">{totalBags}</bdi>{" "}
                {t("bags", "كيس")}
                <span className="text-slate-300 mx-1.5">·</span>
                <bdi className="tabular-nums font-medium text-slate-800">{(totalKg / 1000).toFixed(3)}</bdi> t
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {lines.map((l, i) => (
                <div key={i} className="p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Combobox
                      triggerClassName={SELECT_CLASS + " h-9 flex-1"}
                      value={l.productId}
                      onChange={(v) => setLine(i, { productId: v })}
                      placeholder={t("Product…", "الصنف…")}
                      options={products.map((p) => ({ value: p._id, label: (lang === "ar" && p.nameAr) || p.name }))}
                    />

                    {/* The five real sack sizes the mill fills — nothing else. */}
                    <Combobox
                      triggerClassName={SELECT_CLASS + " h-9 w-28"}
                      value={String(l.bagWeightKg)}
                      onChange={(v) => setLine(i, { bagWeightKg: Number(v) })}
                      options={BAG_WEIGHTS.map((w) => ({ value: String(w), label: `${w} kg` }))}
                    />

                    <Input
                      type="number" min={1} step={1} inputMode="numeric"
                      className="h-9 w-28 text-end tabular-nums"
                      placeholder={t("bags", "أكياس")}
                      value={l.bagCount}
                      onChange={(e) => setLine(i, { bagCount: e.target.value })}
                    />

                    <bdi className="w-24 text-end text-sm tabular-nums text-slate-500">
                      {lineKg(l) ? `${(lineKg(l) / 1000).toFixed(3)} t` : "—"}
                    </bdi>

                    <button
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls))}
                      disabled={lines.length === 1}
                      className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
                      title={t("Remove line", "حذف البند")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline" size="sm" className="mt-2 gap-1.5"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
            >
              <Plus size={14} />
              {t("Add line", "إضافة بند")}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Notes", "ملاحظات")}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {!editing && (
            <p className="text-xs text-slate-400">
              {t(
                "Once saved, the order goes to the Sales Manager. After anyone approves, the quantities can no longer be changed.",
                "بعد الحفظ تنتقل الطلبية إلى مدير المبيعات. وبمجرّد اعتمادها من أي شخص، لا يمكن تغيير الكميات."
              )}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("Cancel", "إلغاء")}</Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving ? t("Saving…", "جارٍ الحفظ…") : editing ? t("Save changes", "حفظ التعديلات") : t("Raise order", "إنشاء الطلبية")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
