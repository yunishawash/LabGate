"use client";
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save, Plus, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useLang } from "@/components/layout/AppShell";
import { LAB_OPERATOR_LABELS, type ILabProduct, type ILabProductSpec, type LabOperator } from "@/types";

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

export function ProductSpecsTab({ products, onProductsChanged }: {
  products: ILabProduct[];
  onProductsChanged: () => void;
}) {
  const { lang, t } = useLang();

  const [productId, setProductId] = useState("");
  const [specs, setSpecs] = useState<ILabProductSpec[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", nameAr: "" });
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");

  useEffect(() => {
    if (!productId && products.length) setProductId(products[0]._id);
  }, [products, productId]);

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

  const createProduct = async () => {
    if (!newProduct.name.trim()) return;
    setProductSaving(true);
    setProductError("");
    try {
      const res = await fetch("/api/lab/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProduct),
      });
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
    setNewProductOpen(false);
    setNewProduct({ name: "", nameAr: "" });
    onProductsChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Package size={16} className="text-slate-400" />
        <Combobox
          triggerClassName={SELECT_CLASS + " w-52"}
          value={productId}
          onChange={setProductId}
          options={products.map((p) => ({ value: p._id, label: (lang === "ar" && p.nameAr) || p.name }))}
        />
        <span className="text-sm text-slate-400">
          {t(
            "Limits shown are what applies to this product. A blank field means no limit.",
            "الحدود المعروضة هي المطبَّقة على هذا الصنف. الحقل الفارغ يعني بدون حد."
          )}
        </span>
        <Button variant="outline" size="sm" className="ms-auto gap-1.5" onClick={() => setNewProductOpen(true)}>
          <Plus size={14} />
          {t("New product", "صنف جديد")}
        </Button>
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

      <Dialog open={newProductOpen} onOpenChange={(o) => !o && setNewProductOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("New product", "صنف جديد")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Name", "الاسم")} *</Label>
              <Input value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Arabic name", "الاسم بالعربية")}</Label>
              <Input value={newProduct.nameAr} onChange={(e) => setNewProduct((p) => ({ ...p, nameAr: e.target.value }))} />
            </div>
            {productError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{productError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewProductOpen(false)} disabled={productSaving}>
              {t("Cancel", "إلغاء")}
            </Button>
            <Button onClick={createProduct} disabled={productSaving || !newProduct.name.trim()}>
              {productSaving ? t("Saving…", "جارٍ الحفظ…") : t("Create", "إنشاء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
