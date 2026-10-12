"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Save, Plus, Package, SlidersHorizontal, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useLang } from "@/components/layout/AppShell";
import {
  LAB_OPERATOR_LABELS, productPickerOptions, isOrderableProduct,
  type ILabProduct, type ILabProductSpec, type ILabParameter, type LabOperator,
} from "@/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/** A spec row being edited. Empty string means "no limit", which is different
 *  from zero — hence strings rather than numbers while typing. */
interface Draft {
  min: string;
  max: string;
  target: string;
  operator: LabOperator;
}

const toDraft = (s: ILabProductSpec): Draft => ({
  min: s.min == null ? "" : String(s.min),
  max: s.max == null ? "" : String(s.max),
  target: s.target == null ? "" : String(s.target),
  operator: s.operator,
});

const same = (a: Draft, b: Draft) =>
  a.min === b.min && a.max === b.max && a.target === b.target && a.operator === b.operator;

const EMPTY_PARAM = {
  name: "", nameAr: "", unit: "", operator: "range" as LabOperator,
  defaultMin: "", defaultMax: "", defaultTarget: "", order: "0",
  /** Empty = applies to every product. See LabParameter.productIds. */
  productIds: [] as string[],
};

/**
 * Per-product spec limits, and the plant-wide parameter (test) catalog.
 *
 * Which product TYPES AND GRADES exist used to be edited here too, until it
 * moved to its own page — Lab → Product Catalog (client request, 2026-10-12)
 * — because that is a different, much rarer job (a grade launches or is
 * retired) than this one (routine QA work, done constantly), and listing
 * every type and every grade on every visit here buried the routine job
 * under the structural one. `products` is still read here — the picker below
 * needs the whole catalogue to choose from — just no longer written.
 */
export function ProductSpecsTab({ products, parameters, onParametersChanged }: {
  products: ILabProduct[];
  parameters: ILabParameter[];
  onParametersChanged: () => void;
}) {
  const { lang, t } = useLang();

  const [productId, setProductId] = useState("");
  const [specs, setSpecs] = useState<ILabProductSpec[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Global parameter (test) catalog — add/edit/remove.
  const [paramDialogOpen, setParamDialogOpen] = useState(false);
  const [editingParam, setEditingParam] = useState<ILabParameter | null>(null);
  const [paramForm, setParamForm] = useState(EMPTY_PARAM);
  const [paramSaving, setParamSaving] = useState(false);
  const [paramError, setParamError] = useState("");

  // "Copy from…" — clone another product's resolved spec sheet onto this one.
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copySaving, setCopySaving] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    // The first ORDERABLE row, not the first row: "طحين" has no spec sheet of
    // its own, so defaulting to it would open this screen on an empty table.
    if (productId) return;
    const first = products.find(isOrderableProduct);
    if (first) setProductId(first._id);
  }, [products, productId]);

  const selectedProduct = products.find((p) => p._id === productId) ?? null;
  const productTypes = products.filter((p) => !p.parentId);
  const parentOfSelected = selectedProduct?.parentId
    ? products.find((p) => p._id === selectedProduct.parentId) ?? null
    : null;

  const loadSpecs = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lab/products/${productId}/specs`);
      const data = await res.json();
      const list: ILabProductSpec[] = data.specs || [];
      setSpecs(list);
      setDrafts(Object.fromEntries(list.map((s) => [s.parameterId, toDraft(s)])));
    } catch {
      setError(t("Could not load the specification.", "تعذّر تحميل المواصفة."));
    }
    setLoading(false);
  }, [productId, t]);

  useEffect(() => { loadSpecs(); }, [loadSpecs]);

  const openCopyDialog = () => {
    setCopySourceId("");
    setCopyError("");
    setCopyDialogOpen(true);
  };

  const runCopy = async () => {
    if (!productId || !copySourceId) return;
    setCopySaving(true);
    setCopyError("");
    try {
      const res = await fetch(`/api/lab/products/${productId}/specs/copy-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProductId: copySourceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCopyError((data as { error?: string }).error || `Error ${res.status}`);
        setCopySaving(false);
        return;
      }
      setCopySaving(false);
      setCopyDialogOpen(false);
      await loadSpecs();
    } catch {
      setCopyError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setCopySaving(false);
    }
  };

  const setField = (parameterId: string, field: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [parameterId]: { ...d[parameterId], [field]: value } as Draft }));

  const saveOverride = async (spec: ILabProductSpec) => {
    const draft = drafts[spec.parameterId];
    if (!draft) return;

    const min = draft.min === "" ? null : Number(draft.min);
    const max = draft.max === "" ? null : Number(draft.max);
    if (min !== null && max !== null && min > max) {
      setError(t("Minimum cannot be greater than maximum.", "لا يمكن أن يكون الحد الأدنى أكبر من الأعلى."));
      return;
    }

    setSavingId(spec.parameterId);
    setError("");
    try {
      const res = await fetch("/api/lab/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameterId: spec.parameterId,
          productId,
          min, max,
          target: draft.target === "" ? null : Number(draft.target),
          operator: draft.operator,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error || `Error ${res.status}`);
      } else {
        await loadSpecs();
      }
    } catch {
      setError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
    }
    setSavingId(null);
  };

  const removeOverride = async (spec: ILabProductSpec) => {
    if (!spec.overrideId) return;
    if (!confirm(t(
      `Reset ${spec.name} to the plant-wide default?`,
      `إعادة ${spec.nameAr || spec.name} إلى القيمة الافتراضية العامة؟`
    ))) return;

    setSavingId(spec.parameterId);
    await fetch(`/api/lab/thresholds/${spec.overrideId}`, { method: "DELETE" });
    await loadSpecs();
    setSavingId(null);
  };

  // ── Parameter (test) catalog CRUD ───────────────────────────────────────
  const openAddParam = () => {
    setEditingParam(null);
    setParamForm({ ...EMPTY_PARAM, order: String(parameters.length + 1) });
    setParamError("");
    setParamDialogOpen(true);
  };
  const openEditParam = (p: ILabParameter) => {
    setEditingParam(p);
    setParamForm({
      name: p.name, nameAr: p.nameAr ?? "", unit: p.unit, operator: p.operator,
      defaultMin: p.defaultMin == null ? "" : String(p.defaultMin),
      defaultMax: p.defaultMax == null ? "" : String(p.defaultMax),
      defaultTarget: p.defaultTarget == null ? "" : String(p.defaultTarget),
      order: String(p.order ?? 0),
      productIds: (p.productIds ?? []).map(String),
    });
    setParamError("");
    setParamDialogOpen(true);
  };

  const saveParam = async () => {
    if (!paramForm.name.trim()) return;
    setParamSaving(true);
    setParamError("");
    try {
      const res = await fetch(
        editingParam ? `/api/lab/parameters/${editingParam._id}` : "/api/lab/parameters",
        {
          method: editingParam ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: paramForm.name.trim(), nameAr: paramForm.nameAr.trim(),
            unit: paramForm.unit.trim(), operator: paramForm.operator,
            defaultMin: paramForm.defaultMin === "" ? null : Number(paramForm.defaultMin),
            defaultMax: paramForm.defaultMax === "" ? null : Number(paramForm.defaultMax),
            defaultTarget: paramForm.defaultTarget === "" ? null : Number(paramForm.defaultTarget),
            order: parseInt(paramForm.order, 10) || 0,
            productIds: paramForm.productIds,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setParamError((d as { error?: string }).error || `Error ${res.status}`);
        setParamSaving(false);
        return;
      }
    } catch {
      setParamError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setParamSaving(false);
      return;
    }
    setParamSaving(false);
    setParamDialogOpen(false);
    setEditingParam(null);
    onParametersChanged();
    if (productId) loadSpecs();
  };

  const removeParam = async (p: ILabParameter) => {
    if (!confirm(t(`Remove parameter "${p.name}"? Past samples keep their recorded readings.`,
      `إزالة المعيار "${p.name}"؟ العيّنات السابقة تحتفظ بقراءاتها المسجَّلة.`))) return;
    await fetch(`/api/lab/parameters/${p._id}`, { method: "DELETE" });
    onParametersChanged();
    if (productId) loadSpecs();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Package size={16} className="text-slate-400" />
        {/* Leaves only, grouped under their type. A spec sheet belongs to the
            thing that is actually sampled — Super, or نخالة — never to the
            category "طحين". Adding, renaming or removing a TYPE or GRADE
            itself is done from Lab → Product Catalog, not here. */}
        <Combobox
          triggerClassName={SELECT_CLASS + " w-52"}
          value={productId}
          onChange={setProductId}
          searchPlaceholder={t("Search products…", "ابحث عن صنف…")}
          options={productPickerOptions(products, lang)}
        />
        {/* Which type this grade belongs to, since the trigger shows only the
            grade's own name once it is chosen. */}
        {parentOfSelected && (
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {t("in", "ضمن")}{" "}
            <bdi className="text-slate-600">
              {(lang === "ar" && parentOfSelected.nameAr) || parentOfSelected.name}
            </bdi>
          </span>
        )}
        {/* Visible without leaving this screen: whether an ORDER of this
            product waits for the lab. The spec sheet below is still worth
            filling in either way — wheat is tested routinely as incoming-grain
            QC even though a wheat order carries no lab gate. */}
        {selectedProduct && selectedProduct.orderRequiresLabTest === false && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">
            {t("Orders skip the lab stage", "الطلبيات تتخطّى مرحلة المختبر")}
          </span>
        )}
        <span className="text-sm text-slate-400">
          {t(
            "Limits shown are what applies to this product. A blank field means no limit.",
            "الحدود المعروضة هي المطبَّقة على هذا الصنف. الحقل الفارغ يعني بدون حد."
          )}
        </span>
        {selectedProduct && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openCopyDialog}>
            <Copy size={13} />
            {t("Copy from…", "نسخ من…")}
          </Button>
        )}
        <Link
          href="/lab/catalog"
          className="ms-auto text-xs text-sky-600 hover:underline whitespace-nowrap"
        >
          {t("Manage types & grades", "إدارة الأنواع والأصناف")}
        </Link>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="text-start font-medium px-4 py-2.5">{t("Parameter", "البارامتر")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Rule", "القاعدة")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Min", "الأدنى")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Max", "الأعلى")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Target", "الهدف")}</th>
              <th className="text-start font-medium px-3 py-2.5">{t("Source", "المصدر")}</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{t("Loading…", "جارٍ التحميل…")}</td></tr>
            ) : specs.length === 0 && productId ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-400">
                    {t("No tests apply to this product yet.", "لا توجد فحوصات مطبَّقة على هذا الصنف بعد.")}
                  </p>
                  <Button variant="outline" size="sm" className="gap-1.5 mt-3" onClick={openCopyDialog}>
                    <Copy size={13} />
                    {t("Copy the spec sheet from another product", "نسخ ورقة المواصفات من صنف آخر")}
                  </Button>
                </td>
              </tr>
            ) : specs.map((spec) => {
              const draft = drafts[spec.parameterId];
              const dirty = draft && !same(draft, toDraft(spec));
              return (
                <tr key={spec.parameterId} className={dirty ? "bg-sky-50/40" : undefined}>
                  <td className="px-4 py-2">
                    <div className="text-slate-800">{(lang === "ar" && spec.nameAr) || spec.name}</div>
                    {spec.unit && <span className="text-xs text-slate-400">{spec.unit}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Combobox
                      triggerClassName={SELECT_CLASS + " w-full"}
                      value={draft?.operator ?? "none"}
                      onChange={(v) => setField(spec.parameterId, "operator", v)}
                      options={(["n_m_t", "n_l_t", "range", "none"] as const).map((o) => ({
                        value: o, label: LAB_OPERATOR_LABELS[o][lang],
                      }))}
                    />
                  </td>
                  {(["min", "max", "target"] as const).map((f) => (
                    <td key={f} className="px-3 py-2">
                      <Input
                        type="number" step="any" inputMode="decimal"
                        className="h-9 w-24 text-end tabular-nums"
                        value={draft?.[f] ?? ""}
                        onChange={(e) => setField(spec.parameterId, f, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {/* Which value is actually in force, and where it came from —
                        the question the QA manager is really asking. */}
                    {spec.hasOverride ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 whitespace-nowrap">
                        {t("This product", "هذا الصنف")}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                        {t("Plant default", "الافتراضي العام")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant={dirty ? "default" : "outline"}
                        disabled={!dirty || savingId === spec.parameterId}
                        onClick={() => saveOverride(spec)}
                        className="gap-1.5"
                      >
                        <Save size={13} />
                        {savingId === spec.parameterId ? t("Saving…", "جارٍ الحفظ…") : t("Save", "حفظ")}
                      </Button>
                      {spec.hasOverride && (
                        <Button
                          size="sm" variant="ghost"
                          disabled={savingId === spec.parameterId}
                          onClick={() => removeOverride(spec)}
                          title={t("Reset to the plant default", "إرجاع للافتراضي العام")}
                        >
                          <RotateCcw size={13} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        {t(
          "Changing a limit affects how FUTURE samples are judged. Samples already recorded keep the limits that applied when they were tested.",
          "تعديل الحد يؤثّر على تقييم العيّنات المستقبلية فقط. أمّا العيّنات المسجّلة فتحتفظ بالحدود التي كانت مطبَّقة وقت فحصها."
        )}
      </p>

      {/* ── Parameter (test) catalog — plant-wide, not per-product ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
              <SlidersHorizontal size={15} className="text-slate-400" />
              {t("Parameter Catalog", "كتالوج المعايير")}
            </h3>
            <p className="text-xs text-slate-400">
              {t(
                "Tests and their plant-wide defaults, used by every product unless overridden above.",
                "الفحوصات وحدودها الافتراضية العامة، تُستخدم لكل الأصناف ما لم تُستثنَ أعلاه."
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openAddParam}>
            <Plus size={14} />
            {t("Add", "إضافة")}
          </Button>
        </div>
        {paramError && (
          <p className="text-sm text-red-600 bg-red-50 border-b border-red-200 px-4 py-2">{paramError}</p>
        )}
        <div className="divide-y divide-slate-100">
          {parameters.map((p) => (
            <div key={p._id} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate text-slate-800">
                  {(lang === "ar" && p.nameAr) || p.name}{p.unit ? ` (${p.unit})` : ""}
                </p>
                <p className="text-xs text-slate-400">
                  {LAB_OPERATOR_LABELS[p.operator][lang]}
                  {(p.defaultMin != null || p.defaultMax != null) && ` — ${p.defaultMin ?? "–"} to ${p.defaultMax ?? "–"}`}
                  {p.defaultTarget != null && ` · ${t("target", "الهدف")} ${p.defaultTarget}`}
                </p>
                {/* Scope, on the row — otherwise the only way to find out
                    which products a test belongs to is to open it. */}
                <p className="text-xs text-slate-400 truncate">
                  {!p.productIds?.length ? (
                    <span className="text-slate-400">{t("All products", "كل الأصناف")}</span>
                  ) : (
                    <span className="text-sky-700">
                      {p.productIds
                        .map((id) => {
                          const pr = products.find((x) => x._id === String(id));
                          return pr ? (lang === "ar" && pr.nameAr) || pr.name : null;
                        })
                        .filter(Boolean)
                        .join("، ")}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEditParam(p)} className="text-xs text-sky-600 hover:underline cursor-pointer">
                  {t("Edit", "تعديل")}
                </button>
                <button onClick={() => removeParam(p)} className="text-xs text-red-500 hover:underline cursor-pointer">
                  {t("Remove", "إزالة")}
                </button>
              </div>
            </div>
          ))}
          {parameters.length === 0 && (
            <p className="text-sm text-slate-400 py-6 text-center">{t("No parameters yet.", "لا توجد معايير بعد.")}</p>
          )}
        </div>
      </div>

      <Dialog open={paramDialogOpen} onOpenChange={(o) => { if (!o) { setParamDialogOpen(false); setEditingParam(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingParam ? t("Edit parameter", "تعديل معيار") : t("Add parameter", "إضافة معيار")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>{t("Name", "الاسم")} *</Label>
                <Input value={paramForm.name} onChange={(e) => setParamForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Moisture" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>{t("Arabic name", "الاسم بالعربية")}</Label>
                <Input value={paramForm.nameAr} onChange={(e) => setParamForm((f) => ({ ...f, nameAr: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Unit", "الوحدة")}</Label>
                <Input value={paramForm.unit} onChange={(e) => setParamForm((f) => ({ ...f, unit: e.target.value }))} placeholder="%" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Rule", "القاعدة")}</Label>
                <Combobox
                  triggerClassName={SELECT_CLASS + " w-full"}
                  value={paramForm.operator}
                  onChange={(v) => setParamForm((f) => ({ ...f, operator: v as LabOperator }))}
                  options={(["n_m_t", "n_l_t", "range", "none"] as const).map((op) => ({
                    value: op, label: LAB_OPERATOR_LABELS[op][lang],
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Default min", "الأدنى الافتراضي")}</Label>
                <Input type="number" step="any" value={paramForm.defaultMin}
                  onChange={(e) => setParamForm((f) => ({ ...f, defaultMin: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Default max", "الأعلى الافتراضي")}</Label>
                <Input type="number" step="any" value={paramForm.defaultMax}
                  onChange={(e) => setParamForm((f) => ({ ...f, defaultMax: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Default target", "الهدف الافتراضي")}</Label>
                <Input type="number" step="any" value={paramForm.defaultTarget}
                  onChange={(e) => setParamForm((f) => ({ ...f, defaultTarget: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Display order", "ترتيب العرض")}</Label>
                <Input type="number" value={paramForm.order}
                  onChange={(e) => setParamForm((f) => ({ ...f, order: e.target.value }))} />
              </div>
            </div>

            {/* Which products this test belongs to.
                Nothing ticked means every product — the permissive default,
                and what every test did before the catalogue was scoped. It is
                said in words rather than left to be inferred from an empty
                box, because "none" and "all" look identical here. */}
            <div className="space-y-1.5">
              <Label>{t("Applies to", "ينطبق على")}</Label>
              <p className="text-xs text-slate-500">
                {paramForm.productIds.length === 0
                  ? t(
                      "Nothing selected — this test applies to every product.",
                      "لم يُحدَّد شيء — هذا الفحص ينطبق على جميع الأصناف."
                    )
                  : t(
                      `Shown only for the ${paramForm.productIds.length} selected product(s).`,
                      `يظهر فقط للأصناف المحدَّدة (${paramForm.productIds.length}).`
                    )}
              </p>
              {/* Types first, each with its grades indented under it.
                  Ticking a TYPE covers every grade of it, now and in future —
                  "these are the flour tests" is one statement about flour, and
                  making QA tick eight grades to say it is eight chances to
                  miss one and eight rows to revisit when a ninth appears.
                  Individual grades stay tickable for the rarer case of a test
                  that genuinely applies to only one of them. */}
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {productTypes.map((type) => {
                  const grades = products.filter((pr) => pr.parentId === type._id);
                  const rows = [{ row: type, isType: true }, ...grades.map((g) => ({ row: g, isType: false }))];
                  const typeTicked = paramForm.productIds.includes(type._id);
                  return (
                    <div key={type._id}>
                      {rows.map(({ row, isType }) => {
                        const on = paramForm.productIds.includes(row._id);
                        // A grade covered by its ticked type is shown as
                        // covered, and disabled — unticking it would not
                        // narrow anything, so offering the click would lie.
                        const covered = !isType && typeTicked;
                        return (
                          <label
                            key={row._id}
                            className={
                              "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 " +
                              (isType ? "font-medium text-slate-800" : "ps-9 text-slate-600") +
                              (covered ? " opacity-60 cursor-default" : " cursor-pointer")
                            }
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-sky-600 cursor-pointer disabled:cursor-default"
                              checked={on || covered}
                              disabled={covered}
                              onChange={() =>
                                setParamForm((f) => ({
                                  ...f,
                                  productIds: on
                                    ? f.productIds.filter((x) => x !== row._id)
                                    : [...f.productIds, row._id],
                                }))
                              }
                            />
                            <span><bdi>{(lang === "ar" && row.nameAr) || row.name}</bdi></span>
                            {isType && grades.length === 0 && (
                              <span className="text-xs text-slate-400">
                                {t("(no grades)", "(بلا أصناف)")}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
                {products.length === 0 && (
                  <p className="text-sm text-slate-400 py-4 text-center">
                    {t("No products yet.", "لا توجد أصناف بعد.")}
                  </p>
                )}
              </div>
              {paramForm.productIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setParamForm((f) => ({ ...f, productIds: [] }))}
                  className="text-xs text-sky-600 hover:underline cursor-pointer"
                >
                  {t("Clear — apply to every product", "إلغاء التحديد — تطبيق على كل الأصناف")}
                </button>
              )}
            </div>

            {paramError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{paramError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setParamDialogOpen(false); setEditingParam(null); }} disabled={paramSaving}>
              {t("Cancel", "إلغاء")}
            </Button>
            <Button onClick={saveParam} disabled={paramSaving || !paramForm.name.trim()}>
              {paramSaving
                ? t("Saving…", "جارٍ الحفظ…")
                : editingParam ? t("Save", "حفظ") : t("Add", "إضافة")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyDialogOpen} onOpenChange={(o) => !o && setCopyDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Copy spec sheet", "نسخ ورقة المواصفات")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t(
                "Copies every test and limit that currently applies to another product onto this one — useful for a brand-new grade that has nothing configured yet.",
                "تنسخ كل فحص وحدّ ينطبق حاليًا على صنف آخر إلى هذا الصنف — مفيدة لصنف جديد لم يُضبط له شيء بعد."
              )}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Copy from", "النسخ من")} *</Label>
              <Combobox
                triggerClassName={SELECT_CLASS + " w-full"}
                value={copySourceId}
                onChange={setCopySourceId}
                searchPlaceholder={t("Search products…", "ابحث عن صنف…")}
                options={productPickerOptions(products, lang).filter((o) => o.value !== productId)}
              />
            </div>
            <p className="text-xs text-slate-400">
              {t(
                "Anything already configured here is left as-is — this only fills in what's missing.",
                "ما هو مضبوط هنا مسبقًا يبقى كما هو — هذا يملأ الناقص فقط."
              )}
            </p>
            {copyError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{copyError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)} disabled={copySaving}>
              {t("Cancel", "إلغاء")}
            </Button>
            <Button onClick={runCopy} disabled={copySaving || !copySourceId}>
              {copySaving ? t("Copying…", "جارٍ النسخ…") : t("Copy", "نسخ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
