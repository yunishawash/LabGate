"use client";
import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";
import type { OrderRow } from "@/components/orders/cells";

export interface WeighLine {
  productId: string;
  product?: string;
  productAr?: string;
  bagWeightKg?: number;
  bagCount?: number;
  lineWeightKg: number;
}

/**
 * One net weight PER LINE — no truck, driver, gross or tare. That was the
 * client's decision, and posting happens in the same action once every line
 * has its own reading: the weighbridge operator has one number per product to
 * enter and one button to press, because a mixed truck is never really one
 * weight — it is one weight per product loaded onto it.
 *
 * The variance shown here is a preview computed the same way the server
 * computes the stored value; the server's numbers are the ones that are kept.
 */
export function WeighDialog({
  open, order, onClose, onDone,
}: { open: boolean; order: OrderRow & { lines: WeighLine[] }; onClose: () => void; onDone: () => void }) {
  const { lang, t } = useLang();
  const [kgs, setKgs] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setKgs(order.lines.map(() => ""));
      setNote("");
      setError("");
    }
    // Only reset when the dialog opens — re-keying on `order.lines` would wipe
    // whatever the operator already typed the moment the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nets = kgs.map((k) => Number(k));
  const allValid = nets.length > 0 && nets.every((n) => Number.isFinite(n) && n > 0);
  const net = allValid ? nets.reduce((s, n) => s + n, 0) : 0;
  const varianceKg = allValid ? net - order.totalWeightKg : 0;
  const variancePct = allValid && order.totalWeightKg
    ? Math.round((varianceKg / order.totalWeightKg) * 10000) / 100
    : 0;
  const wide = Math.abs(variancePct) > 0.5;

  const submit = async () => {
    if (!allValid) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${order._id}/weigh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: nets, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setBusy(false);
        return;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale size={18} className="text-orange-600" />
            {t("Weigh & post", "الوزن والترحيل")}{" "}
            <bdi className="font-mono text-base text-slate-500">{order.orderNumber}</bdi>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between">
            <span className="text-sm text-slate-500">{t("Ordered (all lines)", "المطلوب (كل البنود)")}</span>
            <bdi className="tabular-nums font-medium text-slate-800">
              {(order.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}
              <span className="text-slate-400 font-normal"> ({order.totalWeightKg} kg)</span>
            </bdi>
          </div>

          <div className="space-y-2">
            <div>
              <Label>{t("Actual net weight per line", "الوزن الصافي الفعلي لكل بند")} *</Label>
              <p className="text-xs text-slate-400">
                {t("Enter each value in kilograms (kg), not tons.", "أدخل القيمة بالكيلوغرام (كغم)، وليس بالطن.")}
              </p>
            </div>
            {order.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">
                    {(lang === "ar" && l.productAr) || l.product || "—"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("Ordered", "المطلوب")} {(l.lineWeightKg / 1000).toFixed(3)} {t("t", "طن")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number" min={1} step="any" inputMode="decimal" autoFocus={i === 0}
                    className="w-32 text-end tabular-nums h-10"
                    value={kgs[i] ?? ""}
                    onChange={(e) => setKgs((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder="0"
                  />
                  <span className="text-sm text-slate-400 w-9 flex-shrink-0">{t("kg", "كغم")}</span>
                </div>
              </div>
            ))}
          </div>

          {allValid && (
            <div
              className={
                "rounded-lg px-3 py-2 flex items-center justify-between border " +
                (wide ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200")
              }
            >
              <span className={`text-sm ${wide ? "text-amber-800" : "text-emerald-800"}`}>
                {t("Variance", "الفرق")}
              </span>
              <bdi className={`tabular-nums font-medium ${wide ? "text-amber-800" : "text-emerald-800"}`}>
                {varianceKg > 0 ? "+" : ""}{varianceKg.toFixed(0)} kg
                {" ("}{variancePct > 0 ? "+" : ""}{variancePct}%{")"}
              </bdi>
            </div>
          )}
          {allValid && wide && (
            <p className="text-xs text-amber-700">
              {t(
                "Beyond ±0.5% — this order will show up in the variance report.",
                "أكبر من ±٠٫٥٪ — ستظهر هذه الطلبية في تقرير الفروقات."
              )}
            </p>
          )}

          <div className="space-y-1.5">
            <Label>{t("Note (optional)", "ملاحظة (اختياري)")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <p className="text-xs text-slate-400">
            {t(
              "Saving this weight posts the order and closes it.",
              "حفظ الوزن يُرحِّل الطلبية ويغلقها."
            )}
          </p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel", "إلغاء")}</Button>
          <Button className="bg-orange-600 hover:bg-orange-700" onClick={submit} disabled={busy || !allValid}>
            {busy ? t("Posting…", "جارٍ الترحيل…") : t("Weigh & post", "الوزن والترحيل")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
