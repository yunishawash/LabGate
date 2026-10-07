"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
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
import {
  BAG_WEIGHTS, LINE_PACKAGING_LABELS, productPickerOptions,
  type ILabCustomer, type ILabProduct, type LinePackaging,
} from "@/types";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * A line being typed. Numbers are strings while in the box — an empty field is
 * "nothing entered yet", which is not zero.
 *
 * `bagCount`/`bonusBags` are read only when `packaging` is `bagged`, and
 * `weightKg` only when it is `bulk`. The values of the inactive half are kept
 * rather than cleared, so toggling to صبّ and back does not lose a bag count
 * the person had already typed.
 */
interface Line {
  productId: string;
  packaging: LinePackaging;
  bagWeightKg: number;
  bagCount: string;
  /** Bulk only, in TONNES — the unit the mill sells in. Converted to the
   *  kilograms everything else uses at the API boundary. */
  weightTons: string;
  note: string;
  bonusBags: string;
}

/**
 * Stable ids for the controls a validation message can point at.
 *
 * Collected here rather than written inline at each use so the message and the
 * control it scrolls to cannot drift apart — a blocker that focuses nothing is
 * worse than no blocker, because it looks like the app ignored the click.
 */
const FIELD = {
  customer: "order-customer",
  orderDate: "order-date",
  lines: "order-lines",
  lineProduct: (i: number) => `order-line-${i}-product`,
  lineCount: (i: number) => `order-line-${i}-count`,
  lineWeight: (i: number) => `order-line-${i}-weight`,
};

const emptyLine = (): Line => ({
  productId: "", packaging: "bagged", bagWeightKg: 50,
  bagCount: "", weightTons: "", note: "", bonusBags: "",
});

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customers: ILabCustomer[];
  /** Editing is only possible before the first approval — the server re-checks. */
  editing?: {
    _id: string; customerId: string; referenceNo?: string; orderDate: string;
    deliveryDate?: string | null; notes?: string;
    agentName?: string; paymentMethod?: "cash" | "deferred" | "";
    lines: {
      productId: string; packaging?: LinePackaging;
      bagWeightKg: number | null; bagCount: number | null; lineWeightKg: number;
      note?: string; bonusBags?: number;
    }[];
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
  const [agentName, setAgentName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "deferred" | "">("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  /** Has the person pressed save on an incomplete form? Until they have, the
   *  outstanding items are a quiet checklist rather than a complaint. */
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/lab/products").then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    setError("");
    setAttempted(false);
    if (editing) {
      setCustomerId(editing.customerId);
      setReferenceNo(editing.referenceNo ?? "");
      setOrderDate(toDateInputValue(new Date(editing.orderDate)));
      setDeliveryDate(editing.deliveryDate ? toDateInputValue(new Date(editing.deliveryDate)) : "");
      setNotes(editing.notes ?? "");
      setAgentName(editing.agentName ?? "");
      setPaymentMethod(editing.paymentMethod ?? "");
      setLines(editing.lines.map((l) => {
        // Orders raised before bulk existed carry no `packaging` — every one
        // of them is bagged, and defaulting the other way would silently turn
        // a sack order into a poured one on the next save.
        const packaging: LinePackaging = l.packaging === "bulk" ? "bulk" : "bagged";
        return {
          productId: l.productId,
          packaging,
          bagWeightKg: l.bagWeightKg ?? 50,
          bagCount: l.bagCount == null ? "" : String(l.bagCount),
          weightTons: packaging === "bulk" ? String(l.lineWeightKg / 1000) : "",
          note: l.note ?? "",
          bonusBags: l.bonusBags ? String(l.bonusBags) : "",
        };
      }));
    } else {
      setCustomerId(""); setReferenceNo("");
      setOrderDate(toDateInputValue(new Date()));
      setDeliveryDate(""); setNotes("");
      setAgentName(""); setPaymentMethod("");
      setLines([emptyLine()]);
    }
  }, [open, editing]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // Mirrors what the server computes. The server's numbers are the ones stored —
  // this is only so the person sees the total while typing.
  const lineKg = (l: Line) =>
    l.packaging === "bulk"
      ? (Number(l.weightTons) || 0) * 1000
      : l.bagWeightKg * (parseInt(l.bagCount, 10) || 0);
  // Sacks only. A poured load contributes weight but no bag count, and
  // counting it as zero bags is the truth rather than a gap.
  const totalBags = lines.reduce(
    (n, l) => n + (l.packaging === "bulk" ? 0 : parseInt(l.bagCount, 10) || 0),
    0
  );
  const totalKg = lines.reduce((n, l) => n + lineKg(l), 0);
  const anyBulk = lines.some((l) => l.packaging === "bulk");

  /**
   * What a line may actually be. Only LEAVES: "طحين" is a category, so the
   * warehouse cannot fill it — you order Super. A type with no grades, like
   * نخالة, is its own leaf and appears under a heading of its own name, which
   * reads as what it is rather than as a level gone missing.
   *
   * The server refuses a type on a line regardless; this is so nobody is ever
   * offered one.
   */
  const productOptions = productPickerOptions(products, lang);

  const lineReady = (l: Line) =>
    !!l.productId &&
    (l.packaging === "bulk" ? (Number(l.weightTons) || 0) > 0 : (parseInt(l.bagCount, 10) || 0) >= 1);

  /**
   * The client's rule, surfaced while typing rather than as a 400 on save:
   * one order is either lab-tested or it is not. The server enforces it
   * regardless — this only means the person finds out before filling in the
   * rest of the form.
   */
  const chosen = lines
    .map((l) => products.find((p) => p._id === l.productId))
    .filter((p): p is ILabProduct => !!p);
  const testedChosen = chosen.filter((p) => p.orderRequiresLabTest !== false);
  const untestedChosen = chosen.filter((p) => p.orderRequiresLabTest === false);
  const mixed = testedChosen.length > 0 && untestedChosen.length > 0;
  const labRequired = testedChosen.length > 0;

  /**
   * Everything still standing between this form and a saved order, in words.
   *
   * The button used to just go grey. Every reason it does so — no customer, a
   * line with no product, a bag count left blank, a bulk line with no weight —
   * was invisible, and a person who had fixed one of two problems had no way
   * to tell the second one still existed. The mixing rule had a message; the
   * other four did not, so a disabled button meant "guess".
   *
   * Built in the same order the form reads, and numbered per line, so the
   * sentence points at the control it is about.
   */
  const blockers: { text: string; fieldId: string }[] = [];
  if (!customerId) blockers.push({ text: t("choose a customer", "اختر الزبون"), fieldId: FIELD.customer });
  if (!orderDate) blockers.push({ text: t("set the order date", "حدّد تاريخ الطلبية"), fieldId: FIELD.orderDate });
  lines.forEach((l, i) => {
    const n = i + 1;
    const at = t(`line ${n}`, `البند ${n}`);
    if (!l.productId) {
      blockers.push({ text: `${at}: ${t("choose a product", "اختر الصنف")}`, fieldId: FIELD.lineProduct(i) });
    } else if (l.packaging === "bulk") {
      if (!((Number(l.weightTons) || 0) > 0)) {
        blockers.push({ text: `${at}: ${t("enter the weight in tonnes", "أدخل الوزن بالطن")}`, fieldId: FIELD.lineWeight(i) });
      }
    } else if (!((parseInt(l.bagCount, 10) || 0) >= 1)) {
      blockers.push({ text: `${at}: ${t("enter the number of bags", "أدخل عدد الأكياس")}`, fieldId: FIELD.lineCount(i) });
    }
  });

  /**
   * Where to send the person when they press save on an incomplete form.
   * The mixing rule is about the line list as a whole rather than one
   * control, so it points at the list and lets its own amber block explain.
   */
  const firstProblemId = mixed ? FIELD.lines : blockers[0]?.fieldId;

  const valid =
    !!customerId &&
    !!orderDate &&
    lines.length > 0 &&
    !mixed &&
    lines.every(lineReady);

  const save = async () => {
    /**
     * The button is NOT disabled on an incomplete form.
     *
     * A disabled submit button answers "can I save?" and refuses to answer
     * "why not?" — and this form has five separate reasons it can be
     * incomplete, four of which are about a control somewhere else on a long
     * scrolling page. Someone who set a line to أكياس, saw the button go dead
     * and set it back to صبّ had no way to learn that the real problem was a
     * customer field at the top, far above the part of the form they were
     * working in.
     *
     * So pressing it always does something: either it saves, or it says what
     * is missing and takes you to the first one.
     */
    if (!valid) {
      setAttempted(true);
      if (firstProblemId) {
        const el = document.getElementById(firstProblemId);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        // Not every target is focusable — the line list is a plain div — and
        // scrolling to it is the useful half anyway.
        if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      }
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      customerId,
      referenceNo,
      orderDate,
      deliveryDate: deliveryDate || null,
      notes,
      agentName,
      paymentMethod,
      // Only the half of the line its packaging actually uses is sent. The
      // server recomputes every weight either way, but sending a bag count
      // alongside a bulk line would be sending a fact that is not true.
      lines: lines.map((l) =>
        l.packaging === "bulk"
          ? { productId: l.productId, packaging: "bulk", weightTons: Number(l.weightTons), note: l.note }
          : {
              productId: l.productId,
              packaging: "bagged",
              bagWeightKg: l.bagWeightKg,
              bagCount: parseInt(l.bagCount, 10),
              note: l.note,
              bonusBags: parseInt(l.bonusBags, 10) || 0,
            }
      ),
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
                id={FIELD.customer}
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
              <Input id={FIELD.orderDate} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Delivery date", "تاريخ التسليم")}</Label>
              <Input type="date" value={deliveryDate} min={orderDate}
                onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Sales rep", "اسم المندوب")}</Label>
              {/* Read-only: a rep belongs to the customer, set on the customer form. */}
              <Input readOnly value={customers.find((c) => c._id === customerId)?.salesRepName ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent", "الوكيل")}</Label>
              <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Payment method", "طريقة الدفع")}</Label>
              <select
                className={SELECT_CLASS}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "cash" | "deferred" | "")}
              >
                <option value="">{t("— Not set —", "— غير محدد —")}</option>
                <option value="cash">{t("Cash", "نقدي")}</option>
                <option value="deferred">{t("Deferred", "مؤجل")}</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{t("Lines", "البنود")}</Label>
              <span className="text-xs text-slate-500">
                {/* A bag count of zero on an all-bulk order is noise, not
                    information — the weight is the whole quantity there. */}
                {totalBags > 0 && (
                  <>
                    <bdi className="tabular-nums font-medium text-slate-800">{totalBags}</bdi>{" "}
                    {t("bags", "كيس")}
                    <span className="text-slate-300 mx-1.5">·</span>
                  </>
                )}
                <bdi className="tabular-nums font-medium text-slate-800">{(totalKg / 1000).toFixed(3)}</bdi> t
                {anyBulk && (
                  <>
                    <span className="text-slate-300 mx-1.5">·</span>
                    <span className="text-amber-700">{t("includes bulk", "تشمل صبّ")}</span>
                  </>
                )}
              </span>
            </div>

            <div id={FIELD.lines} className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {lines.map((l, i) => (
                /**
                 * One row per line.
                 *
                 * Seven controls fit because the dialog is `max-w-3xl` and
                 * every fixed-width control is sized to its actual content —
                 * a bag count is never four digits wide. The product gets
                 * `flex-1`, so it takes whatever the others leave rather than
                 * a width guessed in advance.
                 *
                 * `flex-wrap` with a floor of `min-w-36` on the product is the
                 * safety net, not the plan: on a phone the row breaks onto a
                 * second line instead of pushing content out past the dialog's
                 * edge, which is what it did when these controls were laid out
                 * `nowrap`.
                 */
                <div key={i} className="p-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Combobox
                      id={FIELD.lineProduct(i)}
                      triggerClassName={SELECT_CLASS + " h-9 flex-1 min-w-36"}
                      value={l.productId}
                      onChange={(v) => setLine(i, { productId: v })}
                      placeholder={t("Product…", "الصنف…")}
                      searchPlaceholder={t("Search products…", "ابحث عن صنف…")}
                      options={productOptions}
                    />

                    {/* Sacks or poured. Every product supports both, so this is
                        a free choice per line and not a property of the
                        product — bran and wheat are simply the ones that
                        usually go out loose. */}
                    <Combobox
                      triggerClassName={SELECT_CLASS + " h-9 w-[6.5rem] flex-shrink-0"}
                      value={l.packaging}
                      onChange={(v) => setLine(i, { packaging: v as LinePackaging })}
                      options={(["bagged", "bulk"] as LinePackaging[]).map((k) => ({
                        value: k,
                        label: lang === "ar" ? LINE_PACKAGING_LABELS[k].ar : LINE_PACKAGING_LABELS[k].en,
                      }))}
                    />

                    {l.packaging === "bulk" ? (
                      /* One field instead of three: there is nothing to count,
                         so the weight IS the quantity. In kilograms, like
                         every other weight in the system and on the scale.
                         It spans the width the three bagged controls leave
                         behind so the running total stays in the same column
                         on both kinds of line. */
                      <div className="flex items-center gap-1.5 w-[16.75rem] flex-shrink-0">
                        <Input
                          id={FIELD.lineWeight(i)}
                          type="number" min={0.001} step="any" inputMode="decimal"
                          className="h-9 flex-1 min-w-0 text-end tabular-nums"
                          placeholder={t("weight", "الوزن")}
                          title={t("Ordered weight in tonnes", "الوزن المطلوب بالطن")}
                          value={l.weightTons}
                          onChange={(e) => setLine(i, { weightTons: e.target.value })}
                        />
                        <span className="text-xs text-slate-400 flex-shrink-0">{t("t", "طن")}</span>
                      </div>
                    ) : (
                      <>
                        {/* The five real sack sizes the mill fills — nothing else. */}
                        <Combobox
                          triggerClassName={SELECT_CLASS + " h-9 w-24 flex-shrink-0"}
                          value={String(l.bagWeightKg)}
                          onChange={(v) => setLine(i, { bagWeightKg: Number(v) })}
                          options={BAG_WEIGHTS.map((w) => ({ value: String(w), label: `${w} kg` }))}
                        />

                        {/* "العدد", not "أكياس": the control beside it already
                            says أكياس and means the packaging. Two adjacent
                            fields under one word, meaning two different
                            things, is a reading of the row nobody should have
                            to do twice. */}
                        <Input
                          id={FIELD.lineCount(i)}
                          type="number" min={1} step={1} inputMode="numeric"
                          className="h-9 w-[4.75rem] flex-shrink-0 text-end tabular-nums"
                          placeholder={t("count", "العدد")}
                          title={t("Number of bags", "عدد الأكياس")}
                          value={l.bagCount}
                          onChange={(e) => setLine(i, { bagCount: e.target.value })}
                        />

                        <Input
                          type="number" min={0} step={1} inputMode="numeric"
                          className="h-9 w-20 flex-shrink-0 text-end tabular-nums"
                          placeholder={t("bonus", "بونص")}
                          title={t("Bonus bags", "أكياس البونص")}
                          value={l.bonusBags}
                          onChange={(e) => setLine(i, { bonusBags: e.target.value })}
                        />
                      </>
                    )}

                    {/* Fixed width, not `ms-auto`: the totals of two lines have
                        to sit in the same column to be readable as a column,
                        and `ms-auto` would put a bagged line's total and a
                        bulk line's total in different places. */}
                    <bdi className="w-[5.5rem] text-end text-sm tabular-nums text-slate-500 whitespace-nowrap flex-shrink-0">
                      {lineKg(l) ? `${(lineKg(l) / 1000).toFixed(3)} ${t("t", "طن")}` : "—"}
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

          {/* The no-mixing rule, said where it is broken rather than as a 400
              after the form is already filled in. */}
          {mixed && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-900 space-y-1">
                <p className="font-medium">
                  {t(
                    "An order cannot mix lab-tested and untested products.",
                    "لا يمكن أن تجمع الطلبية أصنافًا تخضع للفحص المخبري وأصنافًا لا تخضع له."
                  )}
                </p>
                <p className="text-xs">
                  <bdi>
                    {t("Needs a lab test:", "تخضع للفحص:")}{" "}
                    {Array.from(new Set(testedChosen.map((p) => (lang === "ar" && p.nameAr) || p.name))).join("، ")}
                  </bdi>
                  <span className="text-amber-400 mx-1.5">·</span>
                  <bdi>
                    {t("Does not:", "لا تخضع:")}{" "}
                    {Array.from(new Set(untestedChosen.map((p) => (lang === "ar" && p.nameAr) || p.name))).join("، ")}
                  </bdi>
                </p>
                <p className="text-xs">
                  {t("Raise them as two separate orders.", "اجعلهما طلبيتين منفصلتين.")}
                </p>
              </div>
            </div>
          )}

          {/* An order of bran, germ, semolina or wheat takes a shorter route,
              and the person raising it should know that before it leaves their
              hands — not discover it when the lab never appears. */}
          {!mixed && chosen.length > 0 && !labRequired && (
            <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
              {t(
                "No lab test applies to these products — the order skips the lab stage and goes from the Technical Manager straight to the General Manager's sign-off.",
                "هذه الأصناف لا تخضع للفحص المخبري — تتخطّى الطلبية مرحلة المختبر وتنتقل من المدير التقني إلى اعتماد المدير العام مباشرة."
              )}
            </p>
          )}

          {/* Why the button is grey. Muted and compact — a checklist, not an
              error, since on a fresh form it is simply the list of things not
              filled in yet. Suppressed while the mixing warning is up: that
              block already explains the one thing that matters, and two
              overlapping explanations is worse than one. */}
          {!mixed && blockers.length > 0 && (
            attempted ? (
              /* Pressed save and it did not save — now it is a complaint, and
                 each item is a button that takes you to the control it names. */
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-900">
                  <p className="font-medium">
                    {t("Finish these before raising the order:", "أكمل ما يلي قبل إنشاء الطلبية:")}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {blockers.map((b) => (
                      <li key={b.fieldId}>
                        <button
                          type="button"
                          className="text-start underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600 cursor-pointer"
                          onClick={() => {
                            const el = document.getElementById(b.fieldId);
                            el?.scrollIntoView({ block: "center", behavior: "smooth" });
                            if (el instanceof HTMLElement) el.focus({ preventScroll: true });
                          }}
                        >
                          <bdi>{b.text}</bdi>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                <span className="text-slate-400">{t("To raise this order:", "لإتمام الطلبية:")}</span>{" "}
                <bdi>{blockers.map((b) => b.text).join(" · ")}</bdi>
              </p>
            )
          )}

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
          {/* Disabled only while the request is in flight. See `save()`. */}
          <Button onClick={save} disabled={saving}>
            {saving ? t("Saving…", "جارٍ الحفظ…") : editing ? t("Save changes", "حفظ التعديلات") : t("Raise order", "إنشاء الطلبية")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
