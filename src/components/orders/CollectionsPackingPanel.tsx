"use client";
import { useState, type ReactNode } from "react";
import { Landmark, PackageCheck } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { OrderRow } from "@/components/orders/cells";

type Perms = NonNullable<OrderRow["permissions"]> & {
  canWriteCollections?: boolean;
  canWritePacking?: boolean;
};

interface Props {
  order: OrderRow & {
    collections?: { note?: string; byName?: string; at?: string | null };
    packing?: { note?: string; byName?: string; at?: string | null };
  };
  onDone: () => void;
}

/**
 * Collections (التحصيلات) / Packing (التعبئة) notes printed on the MS-SC/F7
 * form. These are role-gated annotations, not chain stages — they never block
 * the order and can be filled any time, independently of `currentStageIndex`.
 */
export function CollectionsPackingPanel({ order, onDone }: Props) {
  const { t } = useLang();
  const p = (order.permissions ?? {}) as Perms;

  if (!p.canWriteCollections && !p.canWritePacking) return null;

  return (
    <aside className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
      {p.canWriteCollections && (
        <AnnotationField
          icon={<Landmark size={15} className="text-slate-400" />}
          label={t("Collections note", "ملاحظة التحصيلات")}
          kind="collections"
          orderId={order._id}
          value={order.collections}
          onDone={onDone}
        />
      )}
      {p.canWritePacking && (
        <AnnotationField
          icon={<PackageCheck size={15} className="text-slate-400" />}
          label={t("Packing note", "ملاحظة التعبئة")}
          kind="packing"
          orderId={order._id}
          value={order.packing}
          onDone={onDone}
        />
      )}
    </aside>
  );
}

function AnnotationField({
  icon, label, kind, orderId, value, onDone,
}: {
  icon: ReactNode;
  label: string;
  kind: "collections" | "packing";
  orderId: string;
  value?: { note?: string; byName?: string; at?: string | null };
  onDone: () => void;
}) {
  const { t } = useLang();
  const [note, setNote] = useState(value?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = note !== (value?.note ?? "");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, note }),
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
    onDone();
  };

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">{icon}{label}</Label>
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      {value?.byName && (
        <p className="text-xs text-slate-400">{t("Last by", "آخر تحديث من")} {value.byName}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {dirty && (
        <Button size="sm" onClick={save} disabled={saving} className="w-full">
          {saving ? t("Saving…", "جارٍ الحفظ…") : t("Save note", "حفظ الملاحظة")}
        </Button>
      )}
    </div>
  );
}
