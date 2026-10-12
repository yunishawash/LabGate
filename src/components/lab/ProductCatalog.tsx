"use client";
import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Trash2, Pencil, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useLang } from "@/components/layout/AppShell";
import type { ILabProduct } from "@/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 " +
  "outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 cursor-pointer";

/**
 * `parentId` empty means a TYPE (نوع منتج); set means a GRADE (صنف) of that
 * type. `orderRequiresLabTest` is only ever sent for a type — a grade
 * inherits it, and the server refuses to set it on one.
 */
const EMPTY_PRODUCT = { name: "", nameAr: "", parentId: "", orderRequiresLabTest: true };

/**
 * Which product types and grades exist — split out of the Lab page's
 * "Products & Specs" tab (client request, 2026-10-12) into its own page with
 * its own sidebar entry.
 *
 * The two were one screen because they both touch `LabProduct`, but they
 * answer different questions for different moments: this page is "what IS in
 * the catalogue" (an occasional, structural edit — a new grade launches, an
 * old one is retired), while Products & Specs is "what limits apply to THIS
 * one" (routine QA work, done far more often). Burying the second under a
 * type/grade browser that lists every type and every grade on every visit —
 * "Bran: X, Y, Z. Flour: eighteen grades. Germ: …" — made the routine job
 * scroll past the structural one every single time.
 */
export function ProductCatalog() {
  const { lang, t } = useLang();

  const [products, setProducts] = useState<ILabProduct[]>([]);
  const [loading, setLoading] = useState(true);
  /** The type selected in the left table — the right table shows its grades. */
  const [selectedTypeId, setSelectedTypeId] = useState("");

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ILabProduct | null>(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");

  const loadProducts = useCallback(() => {
    setLoading(true);
    fetch("/api/lab/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // The first type once the catalogue arrives, so the grades table is never
  // empty-by-default on a catalogue that already has types in it.
  useEffect(() => {
    if (selectedTypeId || loading) return;
    const first = products.find((p) => !p.parentId);
    if (first) setSelectedTypeId(first._id);
  }, [products, loading, selectedTypeId]);

  const productTypes = products.filter((p) => !p.parentId);
  const selectedType = productTypes.find((p) => p._id === selectedTypeId) ?? null;
  const gradesOfSelectedType = products.filter((p) => p.parentId === selectedTypeId);

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
    loadProducts();
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
    if (selectedTypeId === p._id) setSelectedTypeId("");
    loadProducts();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <Package size={22} className="text-slate-500" />
          {t("Product Catalog", "كتالوج المنتجات")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            "The product types and grades the plant deals in. Spec limits are edited from Lab → Products & Specs.",
            "أنواع المنتجات وأصنافها التي يتعامل بها المصنع. حدود المواصفات تُعدَّل من المختبر ← المنتجات والمواصفات."
          )}
        </p>
      </div>

      {/* Two tables, not one scattered list: TYPES on the left, the SELECTED
          type's GRADES on the right. Clicking a type is how you drill into
          it — the whole reason this read like "prose" before is that every
          type and every one of its grades were printed out together, on
          every visit, whether you wanted that type or not. */}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr] items-start">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Package size={15} className="text-slate-400" />
              {t("Types", "الأنواع")}
            </h3>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openAddProduct("")}>
              <Plus size={14} />
              {t("New type", "نوع جديد")}
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-10">{t("Loading…", "جارٍ التحميل…")}</p>
          ) : productTypes.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">{t("No product types yet.", "لا توجد أنواع منتجات بعد.")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {productTypes.map((type) => {
                  const gradeCount = products.filter((p) => p.parentId === type._id).length;
                  const active = type._id === selectedTypeId;
                  return (
                    <tr
                      key={type._id}
                      onClick={() => setSelectedTypeId(type._id)}
                      className={"cursor-pointer " + (active ? "bg-sky-50" : "hover:bg-slate-50")}
                    >
                      <td className="px-4 py-2.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <bdi className={"truncate " + (active ? "text-sky-800 font-medium" : "text-slate-700")}>
                            {(lang === "ar" && type.nameAr) || type.name}
                          </bdi>
                          {type.orderRequiresLabTest === false && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap flex-shrink-0">
                              {t("no lab stage", "بلا مرحلة مختبر")}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {gradeCount === 0
                            ? t("sold as itself — no grades", "يُباع كما هو — بلا أصناف")
                            : t(`${gradeCount} grade(s)`, `${gradeCount} صنف`)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 w-20">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={(e) => { e.stopPropagation(); openRenameProduct(type); }}
                            className="p-1.5 text-slate-400 hover:text-sky-600 cursor-pointer"
                            title={t("Edit", "تعديل")}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeProduct(type); }}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                            title={t("Remove", "إزالة")}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 gap-2">
            <h3 className="font-semibold text-slate-900 flex items-center gap-1.5 min-w-0">
              <Layers size={15} className="text-slate-400 flex-shrink-0" />
              <span className="truncate">
                {selectedType
                  ? t(`Grades of `, `أصناف `) + ((lang === "ar" && selectedType.nameAr) || selectedType.name)
                  : t("Grades", "الأصناف")}
              </span>
            </h3>
            <Button
              variant="outline" size="sm" className="gap-1.5 flex-shrink-0"
              disabled={!selectedTypeId}
              onClick={() => openAddProduct(selectedTypeId)}
            >
              <Plus size={14} />
              {t("New grade", "صنف جديد")}
            </Button>
          </div>
          {!selectedTypeId ? (
            <p className="text-sm text-slate-400 text-center py-10">
              {t("Select a type on the left to see its grades.", "اختر نوعًا من اليسار لعرض أصنافه.")}
            </p>
          ) : gradesOfSelectedType.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              {t("Sold as itself — no grades yet.", "يُباع كما هو — لا أصناف بعد.")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {gradesOfSelectedType.map((grade) => (
                  <tr key={grade._id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <bdi className="text-slate-700">{(lang === "ar" && grade.nameAr) || grade.name}</bdi>
                    </td>
                    <td className="px-3 py-2.5 w-20">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openRenameProduct(grade)}
                          className="p-1.5 text-slate-400 hover:text-sky-600 cursor-pointer"
                          title={t("Edit", "تعديل")}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => removeProduct(grade)}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          title={t("Remove", "إزالة")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}
