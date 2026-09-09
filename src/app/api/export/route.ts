import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { containsRegex, dateRange, oid, oneOf } from "@/lib/apiHelpers";
import { buildWorkbook, workbookToBuffer, xlsxResponse, type SheetDef } from "@/lib/excel";
import { visibilityFilter, andFilters, SALES_STAGES, type Actor } from "@/lib/salesWorkflow";
import { liveDelegationRoles } from "@/lib/salesAuth";
import SalesOrder from "@/models/SalesOrder";
import LabSample from "@/models/LabSample";
import LabParameter from "@/models/LabParameter";
import { LAB_STATUSES, LAB_SHIFTS } from "@/lib/labConstants";
import {
  LAB_STATUS_LABELS, LAB_DECISION_LABELS,
  type LabStatus, type LabDecision, type ILabSampleResult,
} from "@/types";

const TYPES = ["orders", "pipeline", "cycleTime", "lab"] as const;

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

  if (type === "lab") {
    const filter: Record<string, unknown> = { isActive: true };

    const productId = searchParams.get("product");
    if (productId && productId !== "all") {
      const id = oid(productId);
      if (!id) return NextResponse.json({ error: "Invalid product" }, { status: 400 });
      filter.productId = id;
    }

    const customerId = searchParams.get("customer");
    if (customerId && customerId !== "all") {
      const id = oid(customerId);
      if (!id) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
      filter.customerId = id;
    }

    const status = searchParams.get("status");
    if (status && status !== "all") filter.overallStatus = oneOf(status, LAB_STATUSES, "pass");

    const shift = searchParams.get("shift");
    if (shift && shift !== "all") filter.shift = oneOf(shift, LAB_SHIFTS, "");

    const search = searchParams.get("search");
    if (search) {
      const rx = containsRegex(search);
      filter.$or = [{ sampleNumber: rx }, { batchId: rx }, { orderNumber: rx }];
    }

    const labRange = dateRange(searchParams.get("from"), searchParams.get("to"));
    if (labRange) filter.sampleDate = labRange;

    const [samples, activeParameters] = await Promise.all([
      LabSample.find(filter).sort({ sampleDate: -1 }).limit(5000).lean(),
      LabParameter.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
    ]);

    const isoDate = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);
    const statusText = (s: LabStatus) => LAB_STATUS_LABELS[s]?.[lang] ?? s;
    const decisionText = (d: LabDecision) =>
      d && d !== "pending" ? LAB_DECISION_LABELS[d]?.[lang] ?? d : "";

    // Sheet 1 — pivoted, one row per sample, one column per active parameter,
    // the way the printed QC report reads.
    const resultsHeaders = [
      t("Sample #", "رقم العيّنة"), t("Date", "التاريخ"), t("Shift", "الوردية"),
      t("Batch/Lot", "الدفعة"), t("Product", "الصنف"), t("Customer", "الزبون"),
      t("Tested by", "الفاحص"),
      ...activeParameters.map((p) => (p.unit ? `${p.name} (${p.unit})` : p.name)),
      t("Lab Status", "حالة المختبر"), t("Final Decision", "الاعتماد النهائي"),
      t("Decision Note", "ملاحظة الاعتماد"),
    ];
    const resultsRows = samples.map((s) => {
      const byParam = new Map(
        (s.results as ILabSampleResult[]).map((r) => [String(r.parameterId), r.value])
      );
      return [
        s.sampleNumber, isoDate(s.sampleDate), s.shift || "", s.batchId || "",
        s.product, s.customer || "", s.testedByName,
        ...activeParameters.map((p) => byParam.get(String(p._id)) ?? null),
        statusText(s.overallStatus), decisionText(s.finalDecision), s.finalDecisionNote || "",
      ];
    });

    // Sheet 2 — one row per individual reading, carrying the spec limits and
    // deviation that applied at test time (frozen per-result, see LabSample.ts).
    const detailHeaders = [
      t("Sample #", "رقم العيّنة"), t("Date", "التاريخ"), t("Batch/Lot", "الدفعة"),
      t("Product", "الصنف"), t("Customer", "الزبون"), t("Parameter", "البارامتر"),
      t("Unit", "الوحدة"), t("Result", "النتيجة"), t("Min", "الحد الأدنى"),
      t("Max", "الحد الأقصى"), t("Target", "الهدف"),
      t("Deviation from Target", "الانحراف عن الهدف"), t("Status", "الحالة"),
    ];
    const detailRows = samples.flatMap((s) =>
      (s.results as ILabSampleResult[]).map((r) => [
        s.sampleNumber, isoDate(s.sampleDate), s.batchId || "", s.product, s.customer || "",
        r.parameterName, r.unit || "", r.value, r.min ?? null, r.max ?? null, r.target ?? null,
        r.deviation != null ? `${(r.deviation * 100).toFixed(1)}%` : "",
        statusText(r.status),
      ])
    );

    sheets = [
      { name: t("Lab Results", "نتائج المختبر"), headers: resultsHeaders, rows: resultsRows },
      { name: t("Detail", "التفصيل"), headers: detailHeaders, rows: detailRows },
    ];
  }

  if (!sheets.length) return NextResponse.json({ error: "Nothing to export" }, { status: 400 });

  const buf = workbookToBuffer(buildWorkbook(sheets));
  return xlsxResponse(buf, `labgate-${type}-${stamp}.xlsx`);
}
