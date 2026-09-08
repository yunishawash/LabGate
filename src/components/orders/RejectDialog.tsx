"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/layout/AppShell";

/**
 * Rejection is terminal — the client's own rule — so this dialog says so at the
 * point of no return rather than in documentation nobody reads, and refuses to
 * submit without a reason. The reason is not decoration: it is what the
 * rejection-analysis report is built from.
 */
export function RejectDialog({
  open, orderId, orderNumber, onClose, onDone,
}: {
  open: boolean; orderId: string; orderNumber: string;
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setReason(""); setError(""); } }, [open]);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
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

          <div className="space-y-1.5">
            <Label>{t("Reason", "السبب")} *</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("Why is this order being rejected?", "ما سبب رفض هذه الطلبية؟")}
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
            disabled={busy || !reason.trim()}
          >
            {busy ? t("Rejecting…", "جارٍ الرفض…") : t("Reject permanently", "رفض نهائي")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
