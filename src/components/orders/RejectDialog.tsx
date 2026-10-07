"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";
import type { IRejectionReason } from "@/types";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * Rejection is terminal — the client's own rule — so this dialog says so at the
 * point of no return rather than in documentation nobody reads, and refuses to
 * submit without a reason. The reason is not decoration: it is what the
 * rejection-analysis report is built from.
 *
 * The Technical Manager rejects from a closed, admin-managed list and may add
 * a note; every other role writes freely, as before. Which of the two applies
 * is decided by `rejectAsRole`, which the SERVER computed — the browser does
 * not work out whose authority a rejection would be recorded under, because
 * that depends on deputy and delegation facts it cannot see.
 */
export function RejectDialog({
  open, orderId, orderNumber, rejectAsRole, onClose, onDone,
}: {
  open: boolean; orderId: string; orderNumber: string;
  /** From `permissions.rejectAsRole`. Absent only on a caller that has not
   *  been passed the server's permissions block — treated as free text, the
   *  behaviour every role but one has. */
  rejectAsRole?: string;
  onClose: () => void; onDone: () => void;
}) {
  const { lang, t } = useLang();
  const [reason, setReason] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [reasons, setReasons] = useState<IRejectionReason[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fromList = rejectAsRole === "technical_manager";

  useEffect(() => {
    if (!open) return;
    setReason("");
    setReasonId("");
    setError("");
    setLoadFailed(false);
    if (!fromList) return;
    fetch("/api/rejection-reasons")
      .then((r) => r.json())
      .then((d) => {
        const list: IRejectionReason[] = d.reasons || [];
        setReasons(list);
        // One reason is the normal state of this list today, so preselecting it
        // saves a click that has no decision in it. More than one is a real
        // choice and is left unmade.
        if (list.length === 1) setReasonId(list[0]._id);
      })
      .catch(() => setLoadFailed(true));
  }, [open, fromList]);

  const label = (r: IRejectionReason) => (lang === "ar" && r.labelAr) || r.label;

  // The server demands a picked reason from this role and free text from
  // everyone else. Same condition, so the button is never enabled into a 400.
  const ready = fromList ? !!reasonId : !!reason.trim();

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), reasonId: reasonId || undefined }),
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
          <DialogTitle>
            {t("Reject", "رفض")} <bdi className="font-mono text-base">{orderNumber}</bdi>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">
              {t(
                "This is permanent. A rejected order cannot be edited or resubmitted — a new order must be raised.",
                "هذا الإجراء نهائي. الطلبية المرفوضة لا تُعدَّل ولا تُعاد — يجب إنشاء طلبية جديدة."
              )}
            </p>
          </div>

          {fromList && (
            <div className="space-y-1.5">
              <Label>{t("Reason", "السبب")} *</Label>
              <Combobox
                triggerClassName={SELECT_CLASS}
                value={reasonId}
                onChange={setReasonId}
                placeholder={t("Choose a reason…", "اختر السبب…")}
                searchPlaceholder={t("Search reasons…", "ابحث في الأسباب…")}
                options={reasons.map((r) => ({ value: r._id, label: label(r) }))}
              />
              {/* Two different empty states, because they need two different
                  actions: a list that failed to load is a reload, a list that
                  is genuinely empty is a call to the administrator. */}
              {loadFailed ? (
                <p className="text-xs text-red-600">
                  {t(
                    "Could not load the reasons — reload the page and try again.",
                    "تعذّر تحميل الأسباب — أعد تحميل الصفحة ثم حاول مرة أخرى."
                  )}
                </p>
              ) : reasons.length === 0 ? (
                <p className="text-xs text-amber-700">
                  {t(
                    "No rejection reasons are configured. Ask the system administrator to add one.",
                    "لا توجد أسباب رفض معرَّفة. اطلب من مدير النظام إضافة سبب."
                  )}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  {t(
                    "Only the system administrator can add to this list.",
                    "لا يمكن إضافة أسباب إلى هذه القائمة إلّا من قِبل مدير النظام."
                  )}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {fromList
                ? t("Note (optional)", "ملاحظة (اختياري)")
                : `${t("Reason", "السبب")} *`}
            </Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                fromList
                  ? t("Anything to add about this particular order?", "هل من إضافة بخصوص هذه الطلبية تحديدًا؟")
                  : t("Why is this order being rejected?", "ما سبب رفض هذه الطلبية؟")
              }
            />
            <p className="text-xs text-slate-400">
              {t(
                "Everyone who can see this order will see this reason.",
                "كل من يرى هذه الطلبية سيرى هذا السبب."
              )}
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel", "إلغاء")}</Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            onClick={submit}
            disabled={busy || !ready}
          >
            {busy ? t("Rejecting…", "جارٍ الرفض…") : t("Reject permanently", "رفض نهائي")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
