"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Scale } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";
import type { OrderRow } from "@/components/orders/cells";
import { VARIANCE_TOLERANCE_PCT, type LinePackaging } from "@/types";

export interface WeighLine {
  productId: string;
  product?: string;
  productAr?: string;
  packaging?: LinePackaging;
  bagWeightKg?: number | null;
  bagCount?: number | null;
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
  /** What the operator types, in TONNES — the unit on the weighbridge ticket.
   *  Converted to the kilograms everything is stored in at the API boundary. */
  const [tons, setTons] = useState<string[]>([]);
  /** The load itself — where it goes and what carries it. Printed on the
   *  certificate the driver takes with him. */
  const [load, setLoad] = useState({ destination: "", vehicleNo: "", carrier: "", driver: "" });
  /** The scale's own two readings, in tonnes. Their difference is the load
   *  the weighbridge saw; the per-line figures above are its breakdown. */
  const [grossTons, setGrossTons] = useState("");
  const [tareTons, setTareTons] = useState("");
  const [note, setNote] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTons(order.lines.map(() => ""));
      setLoad({ destination: "", vehicleNo: "", carrier: "", driver: "" });
      setGrossTons("");
      setTareTons("");
      setNote("");
      setVarianceReason("");
      setError("");
    }
    // Only reset when the dialog opens — re-keying on `order.lines` would wipe
    // whatever the operator already typed the moment the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nets = tons.map((v) => (Number(v) || 0) * 1000);
  const allValid =
    tons.length > 0 && tons.every((v) => Number.isFinite(Number(v)) && Number(v) > 0);
  const net = allValid ? nets.reduce((s, n) => s + n, 0) : 0;
  const varianceKg = allValid ? net - order.totalWeightKg : 0;
  const variancePct = allValid && order.totalWeightKg
    ? Math.round((varianceKg / order.totalWeightKg) * 10000) / 100
    : 0;
  // Same constant the server checks against — the dialog is where the operator
  // is helped, not where the rule lives.
  const wide = Math.abs(variancePct) > VARIANCE_TOLERANCE_PCT;
  const reasonMissing = wide && !varianceReason.trim();
  /**
   * The field appears for ANY difference, and is demanded only past the
   * tolerance.
   *
   * Showing it only past ±0.5% meant the operator could not record a cause for
   * a small gap even when he knew it — the box did not exist — and the order's
   * report then printed a difference with nothing beside it. Appearing is not
   * the same question as being required, and tying the two together answered
   * the second one twice and the first one never.
   */
  const differs = allValid && Math.round(varianceKg * 1000) !== 0;

  const gross = Number(grossTons);
  const tare = Number(tareTons);
  const scaleOk = Number.isFinite(gross) && Number.isFinite(tare) && gross > 0 && tare > 0 && tare < gross;
  /** What the SCALE saw, as opposed to what was typed per line. */
  const scaleNetKg = scaleOk ? Math.round((gross - tare) * 1000 * 1000) / 1000 : null;
  /**
   * The two figures answer "how much left the mill" from different
   * directions, so a gap between them is a counting mistake somewhere — a
   * line typed wrong, or a tare taken from the wrong truck. Surfaced, not
   * blocked: the operator is standing at the gate with a driver waiting, and
   * a kilogram of rounding is not a reason to refuse the whole posting.
   */
  const scaleGapKg = scaleNetKg != null && allValid ? Math.round((scaleNetKg - net) * 1000) / 1000 : null;
  const scaleDisagrees = scaleGapKg != null && Math.abs(scaleGapKg) >= 1;

  const loadComplete =
    !!load.destination.trim() && !!load.vehicleNo.trim() && !!load.carrier.trim() && !!load.driver.trim();
  const ready = allValid && scaleOk && loadComplete && !reasonMissing;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${order._id}/weigh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tonnes on the wire, as typed; the route converts and stores kg.
        body: JSON.stringify({
          lines: tons.map((v) => Number(v)),
          note,
          varianceReason: varianceReason.trim(),
          weighDestination: load.destination.trim(),
          weighVehicleNo: load.vehicleNo.trim(),
          weighCarrier: load.carrier.trim(),
          weighDriver: load.driver.trim(),
          grossTons: gross,
          tareTons: tare,
        }),
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
            </bdi>
          </div>

          {/* The load, before its weight: who is taking it where. These were
              ruled lines on the printed certificate until now, filled in by
              hand after the fact. */}
          <div className="grid sm:grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label htmlFor="weigh-destination">{t("Destination", "الوجهة")} *</Label>
              <Input
                id="weigh-destination"
                value={load.destination} maxLength={200}
                onChange={(e) => setLoad((l) => ({ ...l, destination: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weigh-vehicle">{t("Vehicle number", "رقم السيارة")} *</Label>
              <Input
                id="weigh-vehicle"
                value={load.vehicleNo} maxLength={60}
                onChange={(e) => setLoad((l) => ({ ...l, vehicleNo: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weigh-carrier">{t("Carrier", "الناقل")} *</Label>
              <Input
                id="weigh-carrier"
                value={load.carrier} maxLength={160}
                onChange={(e) => setLoad((l) => ({ ...l, carrier: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weigh-driver">{t("Driver", "السائق")} *</Label>
              <Input
                id="weigh-driver"
                value={load.driver} maxLength={160}
                onChange={(e) => setLoad((l) => ({ ...l, driver: e.target.value }))}
              />
            </div>
          </div>

          {/* The scale's own two readings. Their difference is checked against
              the per-line total below, which is the whole reason both are
              kept. */}
          <div className="grid grid-cols-3 gap-2.5 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="weigh-gross">{t("Gross", "الكلي")} *</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number" min={0.001} step="any" inputMode="decimal"
                  className="text-end tabular-nums" placeholder="0.000"
                  id="weigh-gross"
                  value={grossTons} onChange={(e) => setGrossTons(e.target.value)}
                />
                <span className="text-sm text-slate-400 flex-shrink-0">{t("t", "طن")}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weigh-tare">{t("Tare", "الفارغ")} *</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number" min={0.001} step="any" inputMode="decimal"
                  className="text-end tabular-nums" placeholder="0.000"
                  id="weigh-tare"
                  value={tareTons} onChange={(e) => setTareTons(e.target.value)}
                />
                <span className="text-sm text-slate-400 flex-shrink-0">{t("t", "طن")}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400">{t("Net (scale)", "الصافي (الميزان)")}</Label>
              <div className="h-10 flex items-center justify-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3">
                <bdi className="tabular-nums text-sm text-slate-700">
                  {scaleNetKg != null ? (scaleNetKg / 1000).toFixed(3) : "—"}
                </bdi>
                <span className="text-sm text-slate-400">{t("t", "طن")}</span>
              </div>
            </div>
          </div>

          {scaleOk && tare >= gross && (
            <p className="text-xs text-red-600">
              {t("The tare must be less than the gross.", "الفارغ يجب أن يكون أقل من الكلي.")}
            </p>
          )}

          <div className="space-y-2">
            <div>
              <Label>{t("Actual net weight per line", "الوزن الصافي الفعلي لكل بند")} *</Label>
              <p className="text-xs text-slate-400">
                {t("Enter each value in tonnes (t) — three decimals is one kilogram.", "أدخل القيمة بالطن — ثلاث خانات عشرية تساوي كيلوغرامًا واحدًا.")}
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
                    {/* Which shape the load was committed in. The operator is
                        looking at a truck, and a poured line has no sack count
                        to reconcile against — saying so here is what stops it
                        being read as a missing figure. */}
                    {l.packaging === "bulk" ? (
                      <span className="text-amber-700"> · {t("bulk", "صبّ")}</span>
                    ) : l.bagCount != null && l.bagWeightKg != null ? (
                      <span> · {l.bagCount} × {l.bagWeightKg} kg</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number" min={0.001} step="any" inputMode="decimal" autoFocus={i === 0}
                    className="w-32 text-end tabular-nums h-10"
                    value={tons[i] ?? ""}
                    onChange={(e) => setTons((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder="0.000"
                  />
                  <span className="text-sm text-slate-400 w-9 flex-shrink-0">{t("t", "طن")}</span>
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
                {varianceKg > 0 ? "+" : ""}{(varianceKg / 1000).toFixed(3)} {t("t", "طن")}
                {" ("}{variancePct > 0 ? "+" : ""}{variancePct}%{")"}
              </bdi>
            </div>
          )}
          {/* Past the tolerance the gap has to be explained before it can be
              posted — a separate field from the note below, because this is
              the justification for a specific number and it is what the
              variance report and the printed certificate carry. */}
          {differs && (
            <div className="space-y-1.5">
              <Label>
                {t("Reason for the difference", "أسباب فرق الوزن")}
                {wide ? " *" : ` ${t("(optional)", "(اختياري)")}`}
              </Label>
              <p className={`text-xs ${wide ? "text-amber-700" : "text-slate-400"}`}>
                {wide
                  ? t(
                      `Beyond ±${VARIANCE_TOLERANCE_PCT}% — this order will show up in the variance report, so the difference has to be explained before it can be posted.`,
                      `أكبر من ±٠٫٥٪ — ستظهر هذه الطلبية في تقرير الفروقات، لذا يجب تبرير الفرق قبل الترحيل.`
                    )
                  : t(
                      "Within tolerance, so this is not required — but whatever you write here is printed on the order report and the certificate beside the difference.",
                      "الفرق ضمن المسموح فلا يلزم تبريره — لكن ما تكتبه هنا يُطبع على تقرير الطلبية وعلى شهادة التوزين بجوار الفرق."
                    )}
              </p>
              <Textarea
                rows={2}
                value={varianceReason}
                onChange={(e) => setVarianceReason(e.target.value)}
                placeholder={t(
                  "e.g. moisture loss in storage, spillage during loading, scale calibration…",
                  "مثال: فقد رطوبة في التخزين، هدر أثناء التحميل، معايرة الميزان…"
                )}
              />
            </div>
          )}

          {/* Two counts of one truck that do not match is a counting mistake,
              and saying so here is the only place anyone would notice. */}
          {scaleDisagrees && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-900">
                {t(
                  "The scale and the line figures disagree:",
                  "قراءة الميزان وأرقام البنود غير متطابقة:"
                )}{" "}
                <bdi className="tabular-nums font-medium">
                  {(scaleNetKg! / 1000).toFixed(3)} {t("t", "طن")}
                </bdi>{" "}
                {t("against", "مقابل")}{" "}
                <bdi className="tabular-nums font-medium">{(net / 1000).toFixed(3)} {t("t", "طن")}</bdi>{" "}
                <bdi className="tabular-nums">
                  ({scaleGapKg! > 0 ? "+" : ""}{(scaleGapKg! / 1000).toFixed(3)})
                </bdi>
                {". "}
                {t("Check before posting — it will not stop you.", "راجعها قبل الترحيل — لن تمنعك من المتابعة.")}
              </p>
            </div>
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
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            onClick={submit}
            disabled={busy || !ready}
          >
            {busy ? t("Posting…", "جارٍ الترحيل…") : t("Weigh & post", "الوزن والترحيل")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
