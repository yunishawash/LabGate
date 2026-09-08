"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { SampleDialog } from "@/components/lab/SampleDialog";
import { formatDate } from "@/lib/utils";
import type { ILabSample, ILabProduct, ILabCustomer } from "@/types";
import type { OrderRow } from "@/components/orders/cells";

type OrderForLab = OrderRow & {
  customerId?: string;
  lines?: { productId: string; product?: string; productAr?: string }[];
  /** Samples already attached to this order, however many products they
   *  cover so far — used to find the next UNCOVERED product when no specific
   *  line was clicked. */
  labSamples?: { productId: string }[];
};

/**
 * Stage 6 — enter the lab's results for this order.
 *
 * CREATING is the default and only path shown at first: a technician who
 * clicked "Enter lab results" wants to enter results, not browse a list of
 * old ones first. This used to open straight into a checklist of existing
 * samples with sample-creation demoted to an external link that left the
 * order entirely — backwards from what the button says.
 *
 * The creation form itself is `SampleDialog`, reused rather than rebuilt: it
 * already owns scoring, thresholds, attachments and the fail alert, and a
 * second copy of that logic is a second place for it to go stale. What THIS
 * component adds is the order-specific plumbing around it — prefilling the
 * customer, and chaining straight from "sample saved" into "attached to this
 * order, stage complete" with no second dialog to find the new sample in.
 *
 * "Link an existing sample" still exists, for the one case it's actually
 * for — a sample tested before the order reached the lab — but only as a
 * fallback reached by backing out of the creation form, not the default.
 *
 * An order can carry several product lines, and each product needs its own
 * tested sample (SPEC: "كل صنف يتم فحصه"). `lineProductId` scopes one call to
 * one specific line, clicked from the order's Lines tab; left unset (the
 * generic "Enter lab results" button in the action panel), this falls back
 * to the first line whose product has no sample attached yet — so a
 * single-line order behaves exactly as before, and a multi-line order just
 * walks through its remaining products one click at a time. The stage-6 step
 * itself stays "pending" server-side until every product is covered, so this
 * dialog stays reachable across repeated calls.
 */
export function LabStepDialog({
  open, order, lineProductId, onClose, onDone,
}: { open: boolean; order: OrderForLab; lineProductId?: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [customers, setCustomers] = useState<ILabCustomer[]>([]);

  /** The line this dialog is scoped to: the one explicitly clicked, or the
   *  first not-yet-tested one. */
  const targetLine = useMemo(() => {
    if (!order.lines?.length) return undefined;
    if (lineProductId) return order.lines.find((l) => l.productId === lineProductId);
    const covered = new Set((order.labSamples ?? []).map((s) => s.productId));
    return order.lines.find((l) => !covered.has(l.productId)) ?? order.lines[0];
  }, [order.lines, order.labSamples, lineProductId]);

  /** How many OTHER distinct products would still be untested after this one
   *  is saved — drives the "both must sign" vs. "N more product(s)" message. */
  const remainingAfterThis = useMemo(() => {
    const covered = new Set((order.labSamples ?? []).map((s) => s.productId));
    if (targetLine) covered.add(targetLine.productId);
    const distinct = new Set((order.lines ?? []).map((l) => l.productId));
    return Array.from(distinct).filter((pid) => !covered.has(pid)).length;
  }, [order.lines, order.labSamples, targetLine]);

  const [samples, setSamples] = useState<ILabSample[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setNote("");
    setMode("new"); // always land back on "create" the next time this opens
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    // A picker, not the paginated Customers table — see the same note on the
    // order pages that fetch this the same way.
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, [open]);

  /**
   * Two sources, in one list: samples already pointed at this order, and
   * recent samples for the same customer not yet attached to any order — the
   * "tested first, link after" case. Loaded only once the fallback view is
   * actually reached, not on every open.
   *
   * The "recent" half is filtered to this dialog's target product — picking a
   * sample of the wrong product wouldn't fail outright (coverage is keyed off
   * the sample's own productId, not the button clicked), it would just leave
   * the intended product still uncovered while looking done. Already-linked
   * samples aren't filtered: they're shown as-is, since they already cover
   * whatever product they were attached for.
   */
  const loadExisting = useCallback(async () => {
    setLoadingExisting(true);
    try {
      const [mine, recent] = await Promise.all([
        fetch(`/api/lab/samples?orderId=${order._id}&limit=20`).then((r) => r.json()),
        order.customerId
          ? fetch(`/api/lab/samples?customerId=${order.customerId}&limit=25`).then((r) => r.json())
          : Promise.resolve({ samples: [] }),
      ]);
      const own: ILabSample[] = mine.samples ?? [];
      const free: ILabSample[] = (recent.samples ?? []).filter(
        (s: ILabSample) =>
          !s.orderId &&
          !own.some((o) => o._id === s._id) &&
          (!targetLine || s.productId === targetLine.productId)
      );
      setSamples([...own, ...free]);
      setPicked(own.map((s) => s._id));
    } catch {
      setSamples([]);
    }
    setLoadingExisting(false);
  }, [order._id, order.customerId, targetLine]);

  useEffect(() => {
    if (open && mode === "existing") loadExisting();
  }, [open, mode, loadExisting]);

  const attach = useCallback(async (sampleIds: string[], noteText: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${order._id}/lab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleIds, note: noteText }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
        setBusy(false);
        return false;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  }, [order._id, t]);

  /** The sample was just created — attach it to this order in the same
   *  motion. One form, one save, stage 6 is done. */
  const handleCreated = useCallback(async (saved?: ILabSample) => {
    if (!saved) return; // SampleDialog only calls this after a real save
    if (await attach([saved._id], "")) { onDone(); onClose(); }
  }, [attach, onDone, onClose]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submitExisting = async () => {
    if (!picked.length) return;
    if (await attach(picked, note)) { onDone(); onClose(); }
  };

  if (!open) return null;

  const productLabel = targetLine ? (targetLine.product || targetLine.productAr || "") : "";

  if (mode === "new") {
    return (
      <SampleDialog
        open={open}
        // Cancelling the entry form doesn't close the whole flow — it falls
        // back to the existing-sample picker, which has the real "Cancel".
        onClose={() => setMode("existing")}
        onSaved={handleCreated}
        products={products}
        customers={customers}
        contextNote={
          productLabel
            ? t(`For order ${order.orderNumber} — testing: ${productLabel}`,
                `للطلبية ${order.orderNumber} — فحص: ${productLabel}`)
            : undefined
        }
        prefill={{
          productId: targetLine?.productId,
          customerId: order.customerId,
          lockProduct: true,
          lockCustomer: true,
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical size={18} className="text-cyan-600" />
            {t("Link an existing sample", "ربط عيّنة موجودة")}{" "}
            <bdi className="font-mono text-base text-slate-500">{order.orderNumber}</bdi>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-500">
              {productLabel
                ? t(
                    `For a "${productLabel}" sample already tested before this order reached the lab.`,
                    `لعيّنة "${productLabel}" سبق فحصها قبل أن تصل الطلبية إلى المختبر.`
                  )
                : t(
                    "For a sample that was already tested before this order reached the lab.",
                    "لعيّنة سبق فحصها قبل أن تصل الطلبية إلى المختبر."
                  )}
            </p>
            <button
              onClick={() => setMode("new")}
              className="text-xs text-sky-700 hover:text-sky-900 whitespace-nowrap cursor-pointer flex-shrink-0"
            >
              {t("Enter a new result instead", "إدخال نتيجة جديدة بدلاً من ذلك")}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {picked.length
                ? t(`${picked.length} selected`, `${picked.length} مُختارة`)
                : t("None selected", "لم يُختَر شيء")}
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {loadingExisting && <p className="p-3 text-sm text-slate-400">{t("Loading…", "جارٍ التحميل…")}</p>}
            {!loadingExisting && !samples.length && (
              <p className="p-3 text-sm text-slate-400">
                {t(
                  "No untested-and-linked samples found for this customer yet.",
                  "لا توجد عيّنات لهذا الزبون بعد."
                )}
              </p>
            )}
            {samples.map((s) => (
              <label key={s._id} className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={picked.includes(s._id)}
                  onChange={() => toggle(s._id)}
                  className="w-4 h-4 accent-cyan-600 cursor-pointer flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 flex items-center gap-2 flex-wrap">
                    <bdi className="font-mono text-xs text-slate-500">{s.sampleNumber}</bdi>
                    <span>{s.product}</span>
                    <QcStatusBadge status={s.overallStatus} size="xs" />
                  </div>
                  <div className="text-xs text-slate-400">
                    <bdi>{formatDate(s.sampleDate)}</bdi>
                    {s.testedByName && <> · {s.testedByName}</>}
                    {s.orderId && s.orderId === order._id && (
                      <span className="text-cyan-700"> · {t("already linked", "مرتبطة مسبقاً")}</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>{t("Note (optional)", "ملاحظة (اختياري)")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <p className="text-xs text-slate-400">
            {remainingAfterThis > 0
              ? t(
                  `${remainingAfterThis} more product(s) on this order still need testing before it can go to sign-off.`,
                  `لا يزال هناك ${remainingAfterThis} صنف/أصناف بحاجة للفحص قبل أن تنتقل الطلبية للاعتماد.`
                )
              : t(
              "Saving sends the order to the General Manager and the Technical Manager — both must sign.",
              "الحفظ يُرسل الطلبية إلى المدير العام والمدير التقني — ويجب أن يوقّع كلاهما."
            )}
          </p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel", "إلغاء")}</Button>
          <Button className="bg-cyan-600 hover:bg-cyan-700" onClick={submitExisting} disabled={busy || !picked.length}>
            {busy ? t("Saving…", "جارٍ الحفظ…") : t("Attach & continue", "إرفاق ومتابعة")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
