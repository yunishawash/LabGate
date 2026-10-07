"use client";
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save, Plus, Package, SlidersHorizontal, Trash2, Pencil } from "lucide-react";
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
 * The add/edit form for a catalogue row.
 *
 * `parentId` empty means a TYPE (نوع منتج); set means a GRADE (صنف) of that
 * type. `orderRequiresLabTest` is only ever sent for a type — a grade inherits
 * it, and the server refuses to set it on one.
 */
const EMPTY_PRODUCT = { name: "", nameAr: "", parentId: "", orderRequiresLabTest: true };

export function ProductSpecsTab({ products, parameters, onProductsChanged, onParametersChanged }: {
  products: ILabProduct[];
  parameters: ILabParameter[];
  onProductsChanged: () => void;
  onParametersChanged: () => void;
}) {
  const { lang, t } = useLang();

  const [productId, setProductId] = useState("");
  const [specs, setSpecs] = useState<ILabProductSpec[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Add AND rename share this one dialog — `editingProduct` set means rename.
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ILabProduct | null>(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");

  // Global parameter (test) catalog — add/edit/remove.
  const [paramDialogOpen, setParamDialogOpen] = useState(false);
  const [editingParam, setEditingParam] = useState<ILabParameter | null>(null);
  const [paramForm, setParamForm] = useState(EMPTY_PARAM);
  const [paramSaving, setParamSaving] = useState(false);
  const [paramError, setParamError] = useState("");

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

  const openAddProduct = (parentId = "") => {
    setEditingProduct(null);
    setProductForm({ ...EMPTY_PRODUCT, parentId });
    setProductError("");
    setProductDialogOpen(true);
  };
  const openRenameProduct = (p: ILabProduct) => {
    setEditingProduct(p);
    setProductForm({
      name: p.name,
      nameAr: p.nameAr ?? "",
      parentId: p.parentId ?? "",
      // Absent on a product saved before the flag existed — all flour, all
      // tested. Defaulting the other way would quietly drop the lab stage.
      orderRequiresLabTest: p.orderRequiresLabTest !== false,
    });
    setProductError("");
    setProductDialogOpen(true);
  };

  const saveProduct = async () => {
    if (!productForm.name.trim()) return;
    setProductSaving(true);
    setProductError("");
    try {
      const res = await fetch(
        editingProduct ? `/api/lab/products/${editingProduct._id}` : "/api/lab/products",
        {
          method: editingProduct ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          // `orderRequiresLabTest` goes only with a TYPE. Sending it for a
          // grade is a 400 by design: the decision belongs to the type, and
          // a grade that disagreed with its own type would split one
          // product's orders across two routes.
          body: JSON.stringify(
            productForm.parentId
              ? editingProduct
                ? { name: productForm.name, nameAr: productForm.nameAr }
                : { name: productForm.name, nameAr: productForm.nameAr, parentId: productForm.parentId }
              : {
                  name: productForm.name,
                  nameAr: productForm.nameAr,
                  orderRequiresLabTest: productForm.orderRequiresLabTest,
                }
          ),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setProductError((d as { error?: string }).error || `Error ${res.status}`);
        setProductSaving(false);
        return;
      }
    } catch {
      setProductError(t("Network error — please try again.", "خطأ في الشبكة — يُرجى المحاولة مرة أخرى."));
      setProductSaving(false);
      return;
    }
    setProductSaving(false);
    setProductDialogOpen(false);
    setEditingProduct(null);
    onProductsChanged();
  };

  // Archive, not delete — matches the customer register's own convention: a
  // product referenced by past orders/samples must keep its name on them.
  const removeProduct = async (p: ILabProduct) => {
    const isType = !p.parentId;
    if (!confirm(
      isType
        ? t(`Remove product type "${p.name}"?`, `إزالة نوع المنتج "${p.name}"؟`)
        : t(`Remove grade "${p.name}"?`, `إزالة الصنف "${p.name}"؟`)
    )) return;
    const res = await fetch(`/api/lab/products/${p._id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert((d as { error?: string }).error || `Error ${res.status}`);
      return;
    }
    if (productId === p._id) setProductId("");
    onProductsChanged();
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
            category "طحين". */}
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
        {/* Visible without opening the edit dialog: whether an ORDER of this
            product waits for the lab. The spec sheet below is still worth
            filling in either way — wheat is tested routinely as incoming-grain
            QC even though a wheat order carries no lab gate. */}
        {selectedProduct && selectedProduct.orderRequiresLabTest === false && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">
            {t("Orders skip the lab stage", "الطلبيات تتخطّى مرحلة المختبر")}
          </span>
        )}
        {selectedProduct && (
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openRenameProduct(selectedProduct)}>
              <Pencil size={13} />
              {t("Edit", "تعديل")}
            </Button>
            <Button variant="outline" size="sm" className="text-red-500 hover:bg-red-50 hover:text-red-600"
              onClick={() => removeProduct(selectedProduct)}>
              <Trash2 size={13} />
            </Button>
          </>
        )}
        <span className="text-sm text-slate-400">
          {t(
            "Limits shown are what applies to this product. A blank field means no limit.",
            "الحدود المعروضة هي المطبَّقة على هذا الصنف. الحقل الفارغ يعني بدون حد."
          )}
        </span>
        {/* Two buttons, because they make two different things. One list that
            mixed "طحين" with "Super" is how the catalogue got into the state
            this screen now has to express. */}
        <Button variant="outline" size="sm" className="ms-auto gap-1.5" onClick={() => openAddProduct("")}>
          <Plus size={14} />
          {t("New type", "نوع منتج جديد")}
        </Button>
        <Button
          variant="outline" size="sm" className="gap-1.5"
          disabled={productTypes.length === 0}
          onClick={() => openAddProduct(parentOfSelected?._id ?? selectedProduct?._id ?? productTypes[0]?._id ?? "")}
        >
          <Plus size={14} />
          {t("New grade", "صنف جديد")}
        </Button>
      </div>

      {/* The catalogue's own shape, which the picker above can only hint at.
          Without it there is no screen that answers "what types exist and what
          is under each" — the question this whole two-level change was made
          to make askable. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {productTypes.map((type) => {
            const grades = products.filter((p) => p.parentId === type._id);
            return (
              <div key={type._id} className="min-w-40">
                <p className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                  <bdi>{(lang === "ar" && type.nameAr) || type.name}</bdi>
                  {type.orderRequiresLabTest === false && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                      {t("no lab stage", "بلا مرحلة مختبر")}
                    </span>
                  )}
                  <button
                    onClick={() => openRenameProduct(type)}
                    className="text-slate-300 hover:text-sky-600 cursor-pointer"
                    title={t("Edit type", "تعديل النوع")}
                  >
                    <Pencil size={11} />
                  </button>
                </p>
                {grades.length ? (
                  <p className="text-xs text-slate-400 mt-0.5">
                    <bdi>
                      {grades.map((g) => (lang === "ar" && g.nameAr) || g.name).join("، ")}
                    </bdi>
                  </p>
                ) : (
                  <p className="text-xs text-slate-300 mt-0.5">
                    {t("sold as itself — no grades", "يُباع كما هو — بلا أصناف")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
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

      <Dialog open={productDialogOpen} onOpenChange={(o) => { if (!o) { setProductDialogOpen(false); setEditingProduct(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingProduct
                ? productForm.parentId ? t("Edit grade", "تعديل الصنف") : t("Edit product type", "تعديل نوع المنتج")
                : productForm.parentId ? t("New grade", "صنف جديد") : t("New product type", "نوع منتج جديد")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Name", "الاسم")} *</Label>
              <Input value={productForm.name} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Arabic name", "الاسم بالعربية")}</Label>
              <Input value={productForm.nameAr} onChange={(e) => setProductForm((p) => ({ ...p, nameAr: e.target.value }))} />
            </div>

            {/* Which type a grade belongs to. Fixed once created: moving a
                grade between types would change the spec sheet it resolves
                and, if the two types disagree about the lab, the route its
                future orders take — neither of which should happen as a side
                effect of a rename dialog. */}
            {productForm.parentId && (
              <div className="space-y-1.5">
                <Label>{t("Product type", "نوع المنتج")} *</Label>
                {editingProduct ? (
                  <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <bdi>
                      {(() => {
                        const parent = products.find((x) => x._id === productForm.parentId);
                        return parent ? (lang === "ar" && parent.nameAr) || parent.name : "—";
                      })()}
                    </bdi>
                  </p>
                ) : (
                  <Combobox
                    triggerClassName={SELECT_CLASS + " w-full"}
                    value={productForm.parentId}
                    onChange={(v) => setProductForm((f) => ({ ...f, parentId: v }))}
                    options={productTypes.map((x) => ({
                      value: x._id,
                      label: (lang === "ar" && x.nameAr) || x.name,
                    }))}
                  />
                )}
                <p className="text-xs text-slate-400">
                  {t(
                    "A grade inherits its type's lab rule — it cannot be set separately.",
                    "يرث الصنف قاعدة الفحص من نوعه — ولا تُضبط له على حدة."
                  )}
                </p>
              </div>
            )}

            {/* The flag that decides a whole stage of the approval chain, so it
                is a labelled statement with its consequence spelled out rather
                than a bare switch. Only on a TYPE: the decision is "flour is
                tested, bran is not", which is not a sentence about Super. */}
            {!productForm.parentId && (
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-sky-600 cursor-pointer"
                checked={productForm.orderRequiresLabTest}
                onChange={(e) => setProductForm((p) => ({ ...p, orderRequiresLabTest: e.target.checked }))}
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800">
                  {t("Orders need a lab test", "الطلبيات تخضع للفحص المخبري")}
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  {productForm.orderRequiresLabTest
                    ? t(
                        "An order of this product stops at the lab for results before the General Manager signs it off.",
                        "تتوقّف طلبية هذا الصنف عند المختبر لإدخال النتائج قبل اعتماد المدير العام."
                      )
                    : t(
                        "An order of this product skips the lab stage entirely — from the Technical Manager straight to the General Manager's sign-off. The lab can still test samples of it as routine QC.",
                        "تتخطّى طلبية هذا الصنف مرحلة المختبر تمامًا — من المدير التقني إلى اعتماد المدير العام مباشرة. ويبقى بإمكان المختبر فحص عيّناته كفحص دوري."
                      )}
                </span>
                {/* Already-raised orders keep the route they were created
                    with — the one thing a person flipping this needs to know. */}
                {editingProduct && (
                  <span className="block text-xs text-amber-700 mt-1">
                    {t(
                      "Applies to new orders only, and to every grade of this type. Orders already in progress keep the route they were raised with.",
                      "ينطبق على الطلبيات الجديدة فقط، وعلى كل أصناف هذا النوع. والطلبيات الجارية تحتفظ بالمسار الذي أُنشئت به."
                    )}
                  </span>
                )}
              </span>
            </label>
            )}

            {productError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{productError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setProductDialogOpen(false); setEditingProduct(null); }} disabled={productSaving}>
              {t("Cancel", "إلغاء")}
            </Button>
            <Button onClick={saveProduct} disabled={productSaving || !productForm.name.trim()}>
              {productSaving
                ? t("Saving…", "جارٍ الحفظ…")
                : editingProduct ? t("Save", "حفظ") : t("Create", "إنشاء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
