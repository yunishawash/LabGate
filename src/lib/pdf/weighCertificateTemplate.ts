import { esc, fmtDate, fmtDateTime, fontFaces } from "@/lib/pdf/shared";
import type { LinePackaging } from "@/types";

/**
 * Shape this template reads — a lean SalesOrder.
 *
 * Every field is recorded by the weighbridge stage itself. The vehicle,
 * carrier, driver, destination, gross and tare used to be blank ruled lines
 * filled in by hand after the fact, which left the system holding a net weight
 * it could not attribute to a truck. They are entered before posting now, and
 * the blanks below survive only for orders weighed before that was true.
 */
export interface WeighCertificateData {
  orderNumber: string;
  customer?: string;
  customerAr?: string;
  lines: {
    product?: string;
    productAr?: string;
    /** Absent on every order weighed before bulk loading existed — all
     *  bagged, which is what the row fallbacks assume. */
    packaging?: LinePackaging;
    bagWeightKg?: number | null;
    bagCount?: number | null;
    lineWeightKg?: number;
    actualWeightKg?: number | null;
  }[];
  actualNetWeightKg?: number | null;
  totalWeightKg?: number;
  varianceKg?: number | null;
  variancePct?: number | null;
  /** The weighbridge's stated reason for the gap, demanded past the tolerance.
   *  This document is the one the driver carries away, so an unexplained
   *  difference on it is an argument waiting to happen at the gate. */
  varianceReason?: string;
  weighNote?: string;
  weighedByName?: string;
  postedAt?: string | Date | null;

  /** The load. Empty/null on anything weighed before these were captured. */
  weighDestination?: string;
  weighVehicleNo?: string;
  weighCarrier?: string;
  weighDriver?: string;
  grossWeightKg?: number | null;
  tareWeightKg?: number | null;
}

/** Sack sizes stay in kilograms — the mill fills 50 kg sacks, not 0.05 t ones. */
const kg = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
const tons = (v?: number | null) => (v == null ? "" : (v / 1000).toFixed(3));

/**
 * A captured value, or the ruled line it replaced.
 *
 * Orders weighed before these fields existed have nothing to print, and a
 * certificate that dropped the row would read as though the question was never
 * asked. An empty dotted line says "fill this in", which is what those
 * certificates have always meant.
 */
const filled = (v?: string | null) => (v && v.trim() ? esc(v) : "");

/**
 * The certificate's own CSS, scoped under `.weigh-cert`.
 *
 * Scoped because this markup is also embedded into the MS-SC/F7 order form as
 * one of its pages, and that form has its own `table`, `td`, `.notes-title`
 * and `.footer` rules. Unscoped, the certificate's bare `table { }` and
 * `td, th { }` would repaint every table on the order form.
 *
 * `fontFaces()` is deliberately NOT included: the standalone document adds it
 * once, and the order form already carries it.
 */
export function weighCertificateStyles(): string {
  return `
.weigh-cert { direction: rtl; color: #000; font-family: "Thmanyah", Arial, Tahoma, sans-serif; font-size: 13px; }
.weigh-cert table { width: 100%; border-collapse: collapse; }
.weigh-cert td, .weigh-cert th { border: 1px solid #000; padding: 6px 8px; text-align: center; }
.weigh-cert .text-right { text-align: right; }
.weigh-cert .company { text-align: center; font-size: 22px; font-weight: 700; border: 1px solid #000; background: #e5e7eb; padding: 10px; border-radius: 4px; }
.weigh-cert .company-en { text-align: center; font-size: 11px; color: #444; margin-top: 2px; direction: ltr; }
.weigh-cert .title { text-align: center; font-size: 20px; font-weight: 700; margin: 14px 0 10px; }
.weigh-cert .field { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 9px; }
.weigh-cert .field-label { font-weight: 700; white-space: nowrap; }
.weigh-cert .field-line { flex: 1; border-bottom: 1px dotted #000; min-height: 18px; padding: 0 4px; }
.weigh-cert .grid2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
.weigh-cert .weights { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 14px; }
.weigh-cert .weight-box { border: 1px solid #000; border-radius: 4px; padding: 6px 8px; text-align: center; }
.weigh-cert .weight-box .k { font-size: 11px; color: #444; }
.weigh-cert .weight-box .v { font-size: 18px; font-weight: 700; direction: ltr; min-height: 22px; }
.weigh-cert .items thead th { background: #d1d5db; font-weight: 700; }
.weigh-cert .items tfoot td { font-weight: 700; background: #f3f4f6; }
.weigh-cert .notes { margin-top: 14px; min-height: 40px; border: 1px solid #000; border-radius: 4px; padding: 8px; }
.weigh-cert .notes-title { font-weight: 700; margin-bottom: 4px; }
/* Boxed and tinted, not just another notes block: this is the justification
   for a figure the driver is signing for, and it has to read as part of the
   weights rather than as a remark. */
.weigh-cert .variance { margin-top: 12px; border: 1px solid #b45309; border-radius: 4px; padding: 8px; color: #7c2d12; background: #fff7ed; white-space: pre-wrap; }
.weigh-cert .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 26px; text-align: center; }
.weigh-cert .sig-line { border-bottom: 1px solid #000; height: 34px; margin-bottom: 4px; display: flex; align-items: flex-end; justify-content: center; font-weight: 700; }
.weigh-cert .sig-label { font-size: 12px; font-weight: 700; }
.weigh-cert .sig-hint { font-size: 10px; color: #555; }
.weigh-cert .cert-footer { margin-top: 22px; display: flex; justify-content: space-between; font-size: 11px; color: #444; direction: ltr; }`;
}

/**
 * The certificate's markup, with no document around it.
 *
 * Shared by the standalone printable and by the MS-SC/F7 order form, which
 * carries it as a page: the same sheet, printed on its own at the gate or
 * filed with the order, and never two drifting copies of one document.
 */
export function buildWeighCertificateBody(order: WeighCertificateData): string {
  /**
   * "وزن الوحدة" and "عدد الوحدات" describe sacks. A poured line has neither,
   * so the two cells merge into the one word that is true of it — on a
   * document the driver signs, an empty cell is an invitation to write a
   * number into it later.
   */
  const rows = order.lines
    .map((l, i) => {
      const unitCells =
        l.packaging === "bulk"
          ? `<td colspan="2">صبّ</td>`
          : `<td>${kg(l.bagWeightKg)}</td><td>${l.bagCount ?? ""}</td>`;
      return `
      <tr>
        <td>${i + 1}</td>
        <td class="text-right">${esc(l.productAr || l.product || "")}</td>
        ${unitCells}
        <td>${l.actualWeightKg != null ? tons(l.actualWeightKg) : "—"}</td>
      </tr>`;
    })
    .join("");

  const totalKg = order.actualNetWeightKg ?? order.lines.reduce((s, l) => s + (l.actualWeightKg ?? 0), 0);

  return `
<div class="weigh-cert">
  <div class="company">شركة مطاحن القمح الذهبي</div>
  <div class="company-en">Golden Wheat Mills</div>

  <div class="title">شهادة توزين رقم: ${esc(order.orderNumber)}</div>

  <div class="grid2">
    <div>
      <div class="field"><span class="field-label">الزبون:</span><span class="field-line">${esc(order.customerAr || order.customer || "")}</span></div>
      <div class="field"><span class="field-label">الوجهة:</span><span class="field-line">${filled(order.weighDestination)}</span></div>
      <div class="field"><span class="field-label">السائق:</span><span class="field-line">${filled(order.weighDriver)}</span></div>
    </div>
    <div>
      <div class="field"><span class="field-label">رقم السيارة:</span><span class="field-line">${filled(order.weighVehicleNo)}</span></div>
      <div class="field"><span class="field-label">الناقل:</span><span class="field-line">${filled(order.weighCarrier)}</span></div>
      <div class="field"><span class="field-label">تاريخ التوزين:</span><span class="field-line">${fmtDate(order.postedAt)}</span></div>
    </div>
  </div>

  <!--
    All three in TONNES, the unit the whole system reads and writes in now.
    Gross and tare come from the weighbridge stage; a certificate from before
    they were captured prints blank rather than a false zero.
  -->
  <div class="weights">
    <div class="weight-box"><div class="k">الكلي (طن)</div><div class="v">${tons(order.grossWeightKg)}</div></div>
    <div class="weight-box"><div class="k">الفارغ (طن)</div><div class="v">${tons(order.tareWeightKg)}</div></div>
    <div class="weight-box"><div class="k">الصافي (طن)</div><div class="v">${tons(totalKg)}</div></div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <!-- "وزن الوحدة" stays in kilograms: it is a SACK SIZE, and the mill
             fills 50 kg sacks, not 0.05 t ones. -->
        <th>المتسلسل</th><th>الصنف</th><th>وزن الوحدة (كغ)</th>
        <th>عدد الوحدات</th><th>الوزن الصافي (طن)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="text-right">المجموع</td>
        <td>${tons(totalKg)}</td>
      </tr>
    </tfoot>
  </table>

  ${
    order.varianceReason
      ? `<div class="variance">
    <div class="notes-title">أسباب فرق الوزن:</div>
    <div>${esc(order.varianceReason)}</div>
  </div>`
      : ""
  }

  <div class="notes">
    <div class="notes-title">ملاحظات:</div>
    <div>${esc(order.weighNote || "")}</div>
  </div>

  <div class="sigs">
    <div><div class="sig-line">${esc(order.weighedByName || "")}</div><div class="sig-label">المسؤول</div><div class="sig-hint">(التوقيع)</div></div>
    <div><div class="sig-line">${filled(order.weighDriver)}</div><div class="sig-label">السائق</div><div class="sig-hint">(التوقيع)</div></div>
    <div><div class="sig-line"></div><div class="sig-label">المستلم</div><div class="sig-hint">(التوقيع)</div></div>
  </div>
</div>`;
}

/**
 * The weighbridge certificate (شهادة توزين) as its own printable — handed to
 * the driver once the order is weighed and posted.
 *
 * The same sheet also rides along as a page of the MS-SC/F7 order form. Both
 * render `buildWeighCertificateBody`, so the copy at the gate and the copy in
 * the file cannot drift apart.
 */
export function buildWeighCertificateHtml(order: WeighCertificateData): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>Weighbridge ${esc(order.orderNumber)}</title>
<style>
${fontFaces()}
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
${weighCertificateStyles()}
</style>
</head>
<body>
${buildWeighCertificateBody(order)}
<div class="weigh-cert">
  <div class="cert-footer">
    <span>${fmtDateTime(new Date())}</span>
    <span>تاريخ الطباعة</span>
  </div>
</div>
</body>
</html>`;
}
