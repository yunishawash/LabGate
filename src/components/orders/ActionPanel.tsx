"use client";
import { useState } from "react";
import { Check, X, Scale, FlaskConical, AlertTriangle, UserCheck, Lock } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import { ROLE_LABELS, type UserRole } from "@/types";
import type { OrderRow } from "@/components/orders/cells";
import { RejectDialog } from "@/components/orders/RejectDialog";
import { WeighDialog } from "@/components/orders/WeighDialog";
import { LabStepDialog } from "@/components/orders/LabStepDialog";

type Perms = NonNullable<OrderRow["permissions"]> & {
  canApprove?: boolean; canReject?: boolean; canEnterLab?: boolean;
  canWeigh?: boolean; canEdit?: boolean; actableStageKeys?: string[];
};

/**
 * What this person may do, rendered from the server's `permissions` block and
 * nothing else. The client never re-derives authority — it would be a second
 * copy of the rule, free to drift from the one the API enforces.
 */
export function ActionPanel({
  order, onDone,
}: {
  order: OrderRow & {
    customerId?: string;
    lines?: { productId: string; product?: string; productAr?: string }[];
    labSamples?: { productId: string }[];
  };
  onDone: () => void;
}) {
  const { lang, t } = useLang();
  const p = (order.permissions ?? {}) as Perms;

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);

  const stage = SALES_STAGES.find((s) => s.index === order.currentStageIndex);
  const standIn = p.actingAs;
  const actingLabel = standIn
    ? ROLE_LABELS[standIn.forRole as UserRole]?.[lang] ?? standIn.forRole
    : "";

  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${order._id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
        // A 409 means the world moved under us — showing stale buttons after
        // that is worse than the error itself.
        if (res.status === 409) onDone();
        setBusy(false);
        return;
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setBusy(false);
      return;
    }
    setBusy(false);
    setNote("");
    onDone();
  };

  if (order.status !== "Pending") {
    return (
      <aside className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Lock size={15} className="text-slate-400" />
          {order.status === "Posted"
            ? t("This order is posted and closed.", "هذه الطلبية مرحّلة ومغلقة.")
            : t("This order was rejected and is closed.", "هذه الطلبية مرفوضة ومغلقة.")}
        </div>
      </aside>
    );
  }

  const canAct = p.canApprove || p.canWeigh || p.canEnterLab;

  return (
    <aside className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <h3 className="text-sm font-medium text-slate-900">{t("Your action", "إجراؤك")}</h3>

      {/* Nobody signs as a stand-in without being told they are doing it. */}
      {standIn && canAct && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
          <UserCheck size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800">
            {t("You are acting on behalf of the", "أنت تتصرّف بالإنابة عن")}{" "}
            <strong>{actingLabel}</strong>
            {t(
              ". Your signature will be recorded that way.",
              ". وسيُسجَّل توقيعك على هذا الأساس."
            )}
          </p>
        </div>
      )}

      {p.stalled && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} className="text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-800">
            {t("Stalled — the", "متوقّفة — ")}{" "}
            <strong>{ROLE_LABELS[p.stalled.role as UserRole]?.[lang] ?? p.stalled.role}</strong>{" "}
            {t(
              "is away and this stage has no deputy. It cannot move until they return.",
              "غائب ولا نائب لهذه المرحلة. لن تتحرّك الطلبية حتى يعود."
            )}
          </p>
        </div>
      )}

      {canAct ? (
        <>
          {p.canApprove && (
            <div className="space-y-1.5">
              <Label>{t("Note (optional)", "ملاحظة (اختياري)")}</Label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("Anything the next person should know", "أي ملاحظة يحتاج من بعدك معرفتها")}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {p.canApprove && (
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={approve} disabled={busy}>
                <Check size={16} />
                {busy
                  ? t("Saving…", "جارٍ الحفظ…")
                  : standIn
                    ? t("Approve on behalf", "اعتماد بالإنابة")
                    : t("Approve", "اعتماد")}
              </Button>
            )}

            {p.canWeigh && (
              <Button className="gap-2 bg-orange-600 hover:bg-orange-700" onClick={() => setWeighOpen(true)} disabled={busy}>
                <Scale size={16} />
                {t("Weigh & post", "الوزن والترحيل")}
              </Button>
            )}

            {p.canEnterLab && (
              <Button className="gap-2 bg-cyan-600 hover:bg-cyan-700" onClick={() => setLabOpen(true)} disabled={busy}>
                <FlaskConical size={16} />
                {t("Enter lab results", "إدخال نتائج المختبر")}
              </Button>
            )}

            {p.canReject && (
              <Button variant="outline" className="gap-2 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setRejectOpen(true)} disabled={busy}>
                <X size={16} />
                {t("Reject", "رفض")}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {t("Waiting for", "في انتظار")}{" "}
            <strong className="text-slate-700">
              {stage ? (lang === "ar" ? stage.ar : stage.en) : "—"}
            </strong>
            {t(". Nothing for you to do right now.", ". لا يوجد إجراء مطلوب منك حالياً.")}
          </p>
          {/* The GM can kill a live order at any stage even with no slot of his own. */}
          {p.canReject && (
            <Button variant="outline" className="gap-2 border-red-200 text-red-700 hover:bg-red-50 w-full" onClick={() => setRejectOpen(true)}>
              <X size={16} />
              {t("Reject", "رفض")}
            </Button>
          )}
        </>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <RejectDialog
        open={rejectOpen}
        orderId={order._id}
        orderNumber={order.orderNumber}
        onClose={() => setRejectOpen(false)}
        onDone={onDone}
      />
      <LabStepDialog
        open={labOpen}
        order={order}
        onClose={() => setLabOpen(false)}
        onDone={onDone}
      />
      <WeighDialog
        open={weighOpen}
        order={order}
        onClose={() => setWeighOpen(false)}
        onDone={onDone}
      />
    </aside>
  );
}
