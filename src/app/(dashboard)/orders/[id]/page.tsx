"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardList, Eye, FlaskConical, History, ListTree, Pencil, Printer } from "lucide-react";
import { useLang } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE, type ILabCustomer, type ILabSample } from "@/types";
import { ApprovalTimeline } from "@/components/orders/ApprovalTimeline";
import { ActionPanel } from "@/components/orders/ActionPanel";
import { CollectionsPackingPanel } from "@/components/orders/CollectionsPackingPanel";
import { OrderDialog } from "@/components/orders/OrderDialog";
import { LabStepDialog } from "@/components/orders/LabStepDialog";
import { QcStatusBadge } from "@/components/ui/qc-status-badge";
import { DecisionBadge } from "@/components/ui/decision-badge";
import { SALES_STAGES } from "@/lib/salesWorkflow";
import type { OrderRow } from "@/components/orders/cells";

interface OrderDetail extends OrderRow {
  referenceNo?: string;
  customerId?: string;
  deliveryDate?: string | null;
  notes?: string;
  createdByName?: string;
  createdAt?: string;
  postedAt?: string | null;
  weighNote?: string;
  customerAddress?: string;
  salesRepName?: string;
  agentName?: string;
  paymentMethod?: "cash" | "deferred" | "";
  totalBonusBags?: number;
  totalBonusWeightKg?: number;
  collections?: { note?: string; byName?: string; at?: string | null };
  packing?: { note?: string; byName?: string; at?: string | null };
  lines: {
    productId: string; product: string; productAr?: string;
    bagWeightKg: number; bagCount: number; lineWeightKg: number; note?: string; bonusBags?: number;
  }[];
  /** Samples attached to this order so far — one entry per sample, however
   *  many of the order's products they collectively cover. */
  labSamples?: {
    _id: string; productId: string; sampleNumber: string; overallStatus: string; product?: string;
  }[];
}

interface AuditEntry {
  _id: string; action: string; field: string;
  oldValue: string; newValue: string;
  performedByName: string; notes: string; timestamp: string;
}

const ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  created: { en: "Order raised", ar: "إنشاء الطلبية" },
  updated: { en: "Order edited", ar: "تعديل الطلبية" },
  stage_approved: { en: "Stage approved", ar: "اعتماد مرحلة" },
  stage_rejected: { en: "Order rejected", ar: "رفض الطلبية" },
  lab_attached: { en: "Lab results attached", ar: "إرفاق نتائج المختبر" },
  weighed_posted: { en: "Weighed and posted", ar: "الوزن والترحيل" },
};

export default function OrderDetailPage() {
  const { lang, t } = useLang();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [customers, setCustomers] = useState<ILabCustomer[]>([]);
  const [tab, setTab] = useState<"chain" | "lines" | "history">("chain");
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Per-line lab entry, triggered from the Lines tab: `labLineProductId` is
  // which product this run of the dialog is scoped to (set on a specific
  // line's "Enter sample" click). This is a SEPARATE dialog instance from the
  // one ActionPanel owns for its generic "Enter lab results" button — the two
  // are never open together, but each needs its own product to scope to.
  const [labLineOpen, setLabLineOpen] = useState(false);
  const [labLineProductId, setLabLineProductId] = useState<string | undefined>(undefined);
  const openLabForLine = (productId: string) => {
    setLabLineProductId(productId);
    setLabLineOpen(true);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}`);
      if (!res.ok) {
        // 404 covers both "gone" and "not yours" on purpose — the API must not
        // distinguish them, so neither does this page.
        setError(
          res.status === 404
            ? t("This order does not exist, or is not visible to you yet.",
                "هذه الطلبية غير موجودة، أو لم تصل إليك بعد.")
            : `Error ${res.status}`
        );
        setOrder(null);
        setLoading(false);
        return;
      }
      setError("");
      setOrder(await res.json());
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
    }
    setLoading(false);
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== "history" || !order) return;
    fetch(`/api/orders/${id}/history`)
      .then((r) => r.json())
      .then((d) => setHistory(d.entries || []))
      .catch(() => setHistory([]));
  }, [tab, id, order]);

  useEffect(() => {
    if (!editOpen) return;
    // This is a PICKER, not the paginated Customers table — it needs the whole
    // register to search over, hence the explicit high limit.
    fetch("/api/customers?limit=1000").then((r) => r.json()).then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, [editOpen]);

  // The one place a directional arrow is picked by hand. Everywhere else we
  // avoid them precisely because they do not mirror on their own.
  const Back = lang === "ar" ? ArrowRight : ArrowLeft;

  if (loading) {
    return <p className="text-sm text-slate-500">{t("Loading…", "جارٍ التحميل…")}</p>;
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <Button variant="outline" className="gap-2" onClick={() => router.push("/orders")}>
          <Back size={15} />
          {t("Back to orders", "رجوع للطلبيات")}
        </Button>
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      </div>
    );
  }

  const perms = order.permissions as { canEdit?: boolean; canEnterLab?: boolean } | undefined;
  const canEdit = perms?.canEdit;
  const canEnterLab = perms?.canEnterLab ?? false;
  const tabs = [
    { key: "chain" as const, label: t("Approval chain", "سلسلة الاعتماد"), icon: ListTree },
    { key: "lines" as const, label: t("Lines", "البنود"), icon: ClipboardList },
    { key: "history" as const, label: t("History", "السجل"), icon: History },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button
            onClick={() => router.push("/orders")}
            className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer mb-1.5"
          >
            <Back size={14} />
            {t("Orders", "الطلبيات")}
          </button>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2.5 flex-wrap">
            <bdi className="font-mono">{order.orderNumber}</bdi>
            <span className={`text-xs px-2 py-0.5 rounded-full font-sans ${ORDER_STATUS_BADGE[order.status]}`}>
              {ORDER_STATUS_LABELS[order.status][lang]}
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {((lang === "ar" && order.customerAr) || order.customer) || "—"}
            <span className="text-slate-300 mx-1.5">·</span>
            <bdi>{formatDate(order.orderDate)}</bdi>
            {order.referenceNo && (
              <>
                <span className="text-slate-300 mx-1.5">·</span>
                {t("Ref", "مرجع")} <bdi className="font-mono">{order.referenceNo}</bdi>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open(`/api/orders/${order._id}/pdf`, "_blank")}
          >
            <Printer size={15} />
            {t("Print (MS-SC/F7)", "طباعة (MS-SC/F7)")}
          </Button>
          {canEdit && (
            <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
              <Pencil size={15} />
              {t("Edit", "تعديل")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-1 border-b border-slate-200">
            {tabs.map((x) => (
              <button
                key={x.key}
                onClick={() => setTab(x.key)}
                className={
                  "px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px cursor-pointer transition-colors " +
                  (tab === x.key
                    ? "border-sky-500 text-sky-700 font-medium"
                    : "border-transparent text-slate-500 hover:text-slate-800")
                }
              >
                <x.icon size={15} />
                {x.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            {tab === "chain" && <ApprovalTimeline order={order} />}
            {tab === "lines" && (
              <LinesTable order={order} lang={lang} t={t} canEnterLab={canEnterLab} onTest={openLabForLine} />
            )}
            {tab === "history" && <HistoryList entries={history} lang={lang} t={t} />}
          </div>

          {order.notes && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-sm font-medium text-slate-900 mb-1">{t("Notes", "ملاحظات")}</h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <ActionPanel order={order} onDone={load} />
          <CollectionsPackingPanel order={order} onDone={load} />

          <aside className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2 text-sm">
            <Row label={t("Raised by", "أنشأها")} value={order.createdByName || "—"} />
            <Row label={t("Raised at", "تاريخ الإنشاء")} value={<bdi>{formatDateTime(order.createdAt)}</bdi>} />
            {order.deliveryDate && (
              <Row label={t("Delivery", "التسليم")} value={<bdi>{formatDate(order.deliveryDate)}</bdi>} />
            )}
            <Row label={t("Bags", "الأكياس")} value={<bdi className="tabular-nums">{order.totalBags}</bdi>} />
            <Row
              label={t("Ordered", "الكمية")}
              value={<bdi className="tabular-nums">{(order.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}</bdi>}
            />
            {order.postedAt && (
              <Row label={t("Posted at", "وقت الترحيل")} value={<bdi>{formatDateTime(order.postedAt)}</bdi>} />
            )}
          </aside>
        </div>
      </div>

      <OrderDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
        customers={customers}
        editing={{
          _id: order._id,
          customerId: order.customerId ?? "",
          referenceNo: order.referenceNo,
          orderDate: order.orderDate,
          deliveryDate: order.deliveryDate,
          notes: order.notes,
          salesRepName: order.salesRepName,
          agentName: order.agentName,
          paymentMethod: order.paymentMethod,
          lines: order.lines,
        }}
      />

      <LabStepDialog
        open={labLineOpen}
        order={order}
        lineProductId={labLineProductId}
        onClose={() => setLabLineOpen(false)}
        onDone={load}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 text-end">{value}</span>
    </div>
  );
}

/**
 * Which products already have a tested sample, keyed by productId (not by
 * line — two lines of the same product share one requirement). Multiple
 * samples for one product would keep only the most recently attached one for
 * display; coverage itself is decided server-side.
 */
function coverageByProduct(labSamples: OrderDetail["labSamples"]) {
  const map = new Map<string, { _id: string; sampleNumber: string; overallStatus: string }>();
  for (const s of labSamples ?? []) {
    map.set(s.productId, { _id: s._id, sampleNumber: s.sampleNumber, overallStatus: s.overallStatus });
  }
  return map;
}

function LinesTable({
  order, lang, t, canEnterLab, onTest,
}: {
  order: OrderDetail; lang: "en" | "ar"; t: (en: string, ar: string) => string;
  canEnterLab: boolean; onTest: (productId: string) => void;
}) {
  const covered = coverageByProduct(order.labSamples);
  // Only worth a column at all once the order has reached the lab (or gone
  // past it) — earlier in the chain there is nothing to show yet.
  const showLab = order.currentStageIndex >= 6 || (order.labSamples?.length ?? 0) > 0;

  // The order-detail payload only ever carries a SUMMARY per sample (id,
  // number, verdict) — see the comment on `labSamples` above and the
  // matching `.select()` server-side. The full readings are fetched here,
  // on demand, only when someone actually asks to see them.
  const [viewingSample, setViewingSample] = useState<ILabSample | null>(null);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [viewError, setViewError] = useState("");

  const viewReadings = async (sampleId: string) => {
    setLoadingSampleId(sampleId);
    setViewError("");
    try {
      const res = await fetch(`/api/lab/samples/${sampleId}`);
      if (!res.ok) {
        setViewError(t("Could not load this sample.", "تعذّر تحميل هذه العيّنة."));
        return;
      }
      setViewingSample(await res.json());
    } catch {
      setViewError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
    } finally {
      setLoadingSampleId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-200">
            <th className="text-start font-medium py-2">{t("Product", "الصنف")}</th>
            <th className="text-end font-medium py-2 px-3 whitespace-nowrap">{t("Bag", "الكيس")}</th>
            <th className="text-end font-medium py-2 px-3 whitespace-nowrap">{t("Bags", "الأكياس")}</th>
            <th className="text-end font-medium py-2 whitespace-nowrap">{t("Weight", "الوزن")}</th>
            {showLab && (
              <>
                <th className="text-end font-medium py-2 ps-3 whitespace-nowrap">{t("Lab", "المختبر")}</th>
                <th className="text-end font-medium py-2 ps-3 whitespace-nowrap">{t("Actions", "إجراءات")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.lines.map((l, i) => {
            const c = covered.get(l.productId);
            return (
              <tr key={i}>
                <td className="py-2 text-slate-800">
                  {((lang === "ar" && l.productAr) || l.product) || "—"}
                  {l.note && <span className="block text-xs text-slate-400">{l.note}</span>}
                </td>
                <td className="py-2 px-3 text-end tabular-nums text-slate-600 whitespace-nowrap">{l.bagWeightKg} kg</td>
                <td className="py-2 px-3 text-end tabular-nums text-slate-600">{l.bagCount}</td>
                <td className="py-2 text-end tabular-nums text-slate-800 whitespace-nowrap">
                  {(l.lineWeightKg / 1000).toFixed(3)} {t("t", "طن")}
                </td>
                {showLab && (
                  <>
                    <td className="py-2 ps-3 text-end whitespace-nowrap">
                      {c ? (
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <bdi className="font-mono text-xs text-slate-400">{c.sampleNumber}</bdi>
                          <QcStatusBadge status={c.overallStatus} size="xs" />
                        </span>
                      ) : canEnterLab ? (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 gap-1.5 text-xs border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                          onClick={() => onTest(l.productId)}
                        >
                          <FlaskConical size={13} />
                          {t("Enter sample", "إدخال عيّنة")}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2 ps-3 text-end whitespace-nowrap">
                      {c ? (
                        <button
                          type="button"
                          onClick={() => viewReadings(c._id)}
                          disabled={loadingSampleId === c._id}
                          title={t("View entered values", "عرض القيم المُدخلة")}
                          aria-label={t("View entered values", "عرض القيم المُدخلة")}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 cursor-pointer"
                        >
                          <Eye size={14} />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-medium text-slate-900">
            <td className="py-2">{t("Total", "المجموع")}</td>
            <td />
            <td className="py-2 px-3 text-end tabular-nums">{order.totalBags}</td>
            <td className="py-2 text-end tabular-nums whitespace-nowrap">
              {(order.totalWeightKg / 1000).toFixed(3)} {t("t", "طن")}
            </td>
            {showLab && (
              <>
                <td />
                <td />
              </>
            )}
          </tr>
        </tfoot>
      </table>

      {viewError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
          {viewError}
        </p>
      )}

      {/* Read-only — this is "see what was entered", not a second place to
          edit a sample. Editing stays on the Lab screen, where the scoring
          rules and thresholds actually live. */}
      <Dialog open={!!viewingSample} onOpenChange={(o) => !o && setViewingSample(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewingSample?.sampleNumber}
              {viewingSample && <QcStatusBadge status={viewingSample.overallStatus} />}
              {viewingSample && viewingSample.finalDecision !== "pending" && (
                <DecisionBadge decision={viewingSample.finalDecision} />
              )}
            </DialogTitle>
          </DialogHeader>
          {viewingSample && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs text-slate-500">{t("Date", "التاريخ")}</Label>
                  <p>{formatDate(viewingSample.sampleDate)}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">{t("Tested by", "الفاحص")}</Label>
                  <p>{viewingSample.testedByName}</p>
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                {viewingSample.results.map((r) => (
                  <div
                    key={r.parameterId}
                    className={
                      "flex items-center justify-between gap-3 px-3 py-2 text-sm " +
                      (r.status === "fail" ? "bg-red-50/40" : r.status === "warning" ? "bg-amber-50/40" : "")
                    }
                  >
                    <span className="text-slate-700">
                      {r.parameterName}
                      {r.unit && <span className="text-slate-400"> ({r.unit})</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <bdi className="tabular-nums font-medium text-slate-900">{r.value}</bdi>
                      <QcStatusBadge status={r.status} size="xs" />
                    </span>
                  </div>
                ))}
              </div>
              {viewingSample.notes && (
                <div>
                  <Label className="text-xs text-slate-500">{t("Notes", "ملاحظات")}</Label>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{viewingSample.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function stageLabel(field: string, lang: "en" | "ar"): string {
  const stage = SALES_STAGES.find((s) => s.key === field);
  if (!stage) return field;
  return lang === "ar" ? stage.ar : stage.en;
}

function HistoryList({
  entries, lang, t,
}: { entries: AuditEntry[]; lang: "en" | "ar"; t: (en: string, ar: string) => string }) {
  if (!entries.length) {
    return <p className="text-sm text-slate-400">{t("No history yet.", "لا يوجد سجل بعد.")}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((e) => (
        <li key={e._id} className="py-2.5 flex items-start gap-3">
          <bdi className="text-xs text-slate-400 whitespace-nowrap pt-0.5 min-w-36">
            {formatDateTime(e.timestamp)}
          </bdi>
          <div className="min-w-0">
            <p className="text-sm text-slate-800">
              {ACTION_LABELS[e.action]?.[lang] ?? e.action}
              {/* `field` holds a stage key. Showing `lab_signoff_gm` to a
                  manager is showing them our schema, not their process. */}
              {e.field && <span className="text-slate-400"> · {stageLabel(e.field, lang)}</span>}
            </p>
            <p className="text-xs text-slate-500">{e.performedByName}</p>
            {/* Its own line, not crammed inline after the actor's name with an
             *  em dash — a rejection reason can run to 2000 characters, and
             *  one unbroken line was exactly what made this unreadable AND
             *  (via the table cell equivalent) forced the page to overflow. */}
            {e.notes && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap break-words mt-0.5">
                {e.notes}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
