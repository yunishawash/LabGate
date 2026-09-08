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

/**
 * Net weight only — no truck, driver, gross or tare. That was the client's
 * decision, and posting happens in the same action: the weighbridge operator
 * has one number to enter and one button to press.
 *
 * The variance shown here is a preview computed the same way the server
 * computes the stored value; the server's number is the one that is kept.
 */
export function WeighDialog({
  open, order, onClose, onDone,
}: { open: boolean; order: OrderRow; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const [kg, setKg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setKg(""); setNote(""); setError(""); } }, [open]);

  const net = Number(kg);
  const valid = Number.isFinite(net) && net > 0;
  const varianceKg = valid ? net - order.totalWeightKg : 0;
  const variancePct = valid && order.totalWeightKg
    ? Math.round((varianceKg / order.totalWeightKg) * 10000) / 100
    : 0;
  const wide = Math.abs(variancePct) > 0.5;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${order._id}/weigh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualNetWeightKg: net, note }),
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
            <span className="text-sm text-slate-500">{t("Ordered", "المطلوب")}</span>
            <bdi className="tabular-nums font-medium text-slate-800">
              {(order.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}
              <span className="text-slate-400 font-normal"> ({order.totalWeightKg} kg)</span>
            </bdi>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Actual net weight (kg)", "الوزن الصافي الفعلي (كغم)")} *</Label>
            <Input
              type="number" min={1} step="any" inputMode="decimal" autoFocus
              className="text-end tabular-nums text-lg h-11"
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              placeholder="0"
            />
          </div>

          {valid && (
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
          {valid && wide && (
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
          <Button className="bg-orange-600 hover:bg-orange-700" onClick={submit} disabled={busy || !valid}>
            {busy ? t("Posting…", "جارٍ الترحيل…") : t("Weigh & post", "الوزن والترحيل")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
