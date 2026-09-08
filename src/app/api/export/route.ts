import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { dateRange, oneOf } from "@/lib/apiHelpers";
import { buildWorkbook, workbookToBuffer, xlsxResponse, type SheetDef } from "@/lib/excel";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";

const TYPES = ["orders", "pipeline", "cycleTime"] as const;

const stageName = (i: number | null | undefined, lang: "en" | "ar") => {
  const s = SALES_STAGES.find((x) => x.index === i);
  if (!s) return "";
  return lang === "ar" ? s.groupAr ?? s.ar : s.groupEn ?? s.en;
};

/**
 * Excel export.
 *
 * `requireSession` and `visibilityFilter` are not optional here — an export
 * route that skips them hands over in one file exactly what the whole
 * confidentiality model spends eight stages protecting. (The CMMS's equivalent
 * route has no auth at all; that is the mistake this comment exists to avoid
 * repeating.)
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const actor: Actor = { id: String(userDoc._id), role: userDoc.role };
  const delegated = await liveDelegationRoles(actor.id);
  const visible = visibilityFilter(actor, delegated);

  const { searchParams } = new URL(req.url);
  const type = oneOf(searchParams.get("type"), TYPES, "orders");
  const lang = searchParams.get("lang") === "ar" ? "ar" : "en";
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const range = dateRange(searchParams.get("from"), searchParams.get("to"));

  const stamp = new Date().toISOString().slice(0, 10);
  let sheets: SheetDef[] = [];

  if (type === "orders") {
    const filter = andFilters(visible, range ? { orderDate: range } : {});
    const orders = await SalesOrder.find(filter).sort({ createdAt: -1 }).limit(5000).lean();

    sheets = [
      {
        name: t("Orders", "الطلبيات"),
        headers: [
          t("Order", "الطلبية"), t("Reference", "المرجع"), t("Customer", "الزبون"),
          t("Date", "التاريخ"), t("Bags", "الأكياس"), t("Ordered (t)", "المطلوب (طن)"),
          t("Status", "الحالة"), t("Stage", "المرحلة"), t("Raised by", "أنشأها"),
          t("Actual (t)", "الفعلي (طن)"), t("Variance %", "الفرق %"),
          t("Lab", "المختبر"), t("Rejected by", "رفضها"), t("Reason", "السبب"),
        ],
        rows: orders.map((o) => {
          const d = o as unknown as Record<string, never>;
          const r = (d.rejection ?? {}) as { byName?: string; reason?: string };
          return [
            d.orderNumber as string,
            (d.referenceNo as string) ?? "",
            (lang === "ar" && (d.customerAr as string)) || (d.customer as string) || "",
            new Date(d.orderDate as string).toISOString().slice(0, 10),
            d.totalBags as unknown as number,
            Number((((d.totalWeightKg as unknown as number) ?? 0) / 1000).toFixed(3)),
            d.status as string,
            stageName(d.currentStageIndex as unknown as number, lang),
            (d.createdByName as string) ?? "",
            d.actualNetWeightKg
              ? Number(((d.actualNetWeightKg as unknown as number) / 1000).toFixed(3))
              : null,
            (d.variancePct as unknown as number) ?? null,
            (d.labOverallStatus as string) ?? "",
            r.byName ?? "",
            r.reason ?? "",
          ];
        }),
      },
      {
        name: t("Lines", "البنود"),
        headers: [
          t("Order", "الطلبية"), t("Customer", "الزبون"), t("Product", "الصنف"),
          t("Bag (kg)", "الكيس (كغم)"), t("Bags", "الأكياس"), t("Weight (t)", "الوزن (طن)"),
        ],
        // One row per line, not per order: a per-product tonnage question cannot
        // be answered from a sheet that only has order totals.
        rows: orders.flatMap((o) => {
          const d = o as unknown as Record<string, never>;
          const lines = (d.lines ?? []) as unknown as {
            product: string; productAr?: string; bagWeightKg: number; bagCount: number; lineWeightKg: number;
          }[];
          return lines.map((l) => [
            d.orderNumber as string,
            (lang === "ar" && (d.customerAr as string)) || (d.customer as string) || "",
            (lang === "ar" && l.productAr) || l.product || "",
            l.bagWeightKg,
            l.bagCount,
            Number((l.lineWeightKg / 1000).toFixed(3)),
          ]);
        }),
      },
    ];
  }

  if (type === "pipeline") {
    const rows = await SalesOrder.aggregate([
      { $match: andFilters(visible, { status: "Pending" }) },
      {
        $group: {
          _id: "$currentStageIndex",
          count: { $sum: 1 },
          kg: { $sum: "$totalWeightKg" },
          oldest: { $min: "$currentStageEnteredAt" },
        },
      },
    ]);
    const byIndex = new Map(rows.map((r) => [r._id as number, r]));
    const now = Date.now();

    sheets = [
      {
        name: t("Pipeline", "خط السير"),
        headers: [
          t("Stage", "المرحلة"), t("Name", "الاسم"), t("Orders", "الطلبيات"),
          t("Tons", "الأطنان"), t("Oldest waiting (h)", "أقدم انتظار (ساعة)"),
        ],
        rows: Array.from({ length: 8 }, (_, i) => {
          const r = byIndex.get(i + 1);
          return [
            i + 1,
            stageName(i + 1, lang),
            r?.count ?? 0,
            Number((((r?.kg as number) ?? 0) / 1000).toFixed(3)),
            r?.oldest ? Math.round((now - new Date(r.oldest).getTime()) / 3600000) : null,
          ];
        }),
      },
    ];
  }

  if (type === "cycleTime") {
    const steps = await SalesOrder.aggregate([
      { $match: andFilters(visible, range ? { createdAt: range } : {}) },
      { $unwind: "$steps" },
      { $match: { "steps.actedAt": { $ne: null }, "steps.enteredAt": { $ne: null } } },
      {
        $project: {
          orderNumber: 1,
          stageIndex: "$steps.stageIndex",
          stageKey: "$steps.stageKey",
          actedByName: "$steps.actedByName",
          actedAs: "$steps.actedAs",
          actedForRole: "$steps.actedForRole",
          hours: { $divide: [{ $subtract: ["$steps.actedAt", "$steps.enteredAt"] }, 3600000] },
          actedAt: "$steps.actedAt",
        },
      },
      { $sort: { actedAt: -1 } },
      { $limit: 10000 },
    ]);

    sheets = [
      {
        name: t("Cycle time", "زمن الدورة"),
        headers: [
          t("Order", "الطلبية"), t("Stage", "المرحلة"), t("Name", "الاسم"),
          t("Signed by", "وقّعها"), t("Acting as", "بصفة"), t("On behalf of", "بالإنابة عن"),
          t("Hours held", "ساعات الاحتجاز"), t("Signed at", "وقت التوقيع"),
        ],
        rows: steps.map((s) => [
          s.orderNumber as string,
          s.stageIndex as number,
          stageName(s.stageIndex as number, lang),
          (s.actedByName as string) ?? "",
          (s.actedAs as string) ?? "",
          // Blank unless somebody actually stood in — a column full of the
          // signer's own role tells the reader nothing.
          s.actedAs && s.actedAs !== "primary" ? ((s.actedForRole as string) ?? "") : "",
          Math.round((s.hours as number) * 10) / 10,
          new Date(s.actedAt as string).toISOString().slice(0, 16).replace("T", " "),
        ]),
      },
    ];
  }

  if (!sheets.length) return NextResponse.json({ error: "Nothing to export" }, { status: 400 });

  const buf = workbookToBuffer(buildWorkbook(sheets));
  return xlsxResponse(buf, `labgate-${type}-${stamp}.xlsx`);
}
