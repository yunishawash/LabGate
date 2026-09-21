import fs from "fs";
import path from "path";

/** Shape this template actually reads — a lean SalesOrder plus its steps. */
export interface OrderFormLine {
  product?: string;
  productAr?: string;
  bagCount?: number;
  bagWeightKg?: number;
  lineWeightKg?: number;
  bonusBags?: number;
  note?: string;
}

export interface OrderFormStep {
  stageKey: string;
  actedByName?: string;
  actedAt?: string | Date | null;
  actedAs?: string;
}

export interface OrderFormData {
  orderNumber: string;
  referenceNo?: string;
  customer?: string;
  customerAr?: string;
  customerAddress?: string;
  orderDate?: string | Date;
  salesRepName?: string;
  agentName?: string;
  paymentMethod?: "cash" | "deferred" | "";
  lines: OrderFormLine[];
  collections?: { note?: string; byName?: string; at?: string | Date | null };
  packing?: { note?: string; byName?: string; at?: string | Date | null };
  steps?: OrderFormStep[];
}

/** Minimum rows the items table always shows, so a short order still fills
 *  the same box the printed form allots — the whole point of "fixed table
 *  height" from the paper form. */
const MIN_ITEM_ROWS = 10;

function esc(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d?: string | Date | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB"); // dd/mm/yyyy — matches the footer's own date format
}

function fmtTons(kg?: number): string {
  if (kg === undefined || kg === null) return "";
  return (kg / 1000).toFixed(3);
}

let fontFacesCache: string | null = null;
/** Self-hosted Thmanyah Sans, inlined as base64 so the headless render needs
 *  no filesystem/network reach beyond this one read — Chrome and the
 *  Puppeteer/Playwright PDF path then rasterize from the exact same bytes. */
function fontFaces(): string {
  if (fontFacesCache) return fontFacesCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  const weights: [string, number][] = [
    ["thmanyahsans-Regular.woff2", 400],
    ["thmanyahsans-Medium.woff2", 500],
    ["thmanyahsans-Bold.woff2", 700],
    ["thmanyahsans-Black.woff2", 900],
  ];
  const faces = weights
    .map(([file, weight]) => {
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) return "";
      const b64 = fs.readFileSync(p).toString("base64");
      return `@font-face{font-family:"Thmanyah";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${weight};font-display:swap;}`;
    })
    .filter(Boolean)
    .join("\n");
  fontFacesCache = faces;
  return faces;
}

let logoCache: string | null | undefined;
/** Picks up `public/logo.png` (or `.svg`/`.jpg`) if one is ever dropped in;
 *  falls back to a text lockup when no logo file exists, which is the case
 *  today — there is no company logo asset anywhere in this repo. */
function logoDataUri(): string | null {
  if (logoCache !== undefined) return logoCache;
  const candidates: [string, string][] = [
    ["logo.png", "image/png"],
    ["logo.svg", "image/svg+xml"],
    ["logo.jpg", "image/jpeg"],
  ];
  for (const [file, mime] of candidates) {
    const p = path.join(process.cwd(), "public", file);
    if (fs.existsSync(p)) {
      logoCache = `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
      return logoCache;
    }
  }
  logoCache = null;
  return null;
}

function itemRows(lines: OrderFormLine[]): string {
  const rows = lines.map(
    (l) => `
      <tr>
        <td class="text-right">${esc(l.productAr || l.product || "")}</td>
        <td>${l.bagCount ?? ""}</td>
        <td>${fmtTons(l.lineWeightKg)}</td>
        <td></td>
        <td>${l.bonusBags ? esc(l.bonusBags) : ""}</td>
        <td class="text-right">${esc(l.note || "")}</td>
      </tr>`
  );
  const blanks = Math.max(0, MIN_ITEM_ROWS - lines.length);
  for (let i = 0; i < blanks; i++) {
    rows.push(`<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td>&nbsp;</td></tr>`);
  }
  return rows.join("\n");
}

function stepByKey(steps: OrderFormStep[] | undefined, key: string): OrderFormStep | undefined {
  return steps?.find((s) => s.stageKey === key);
}

function signatureCell(step: OrderFormStep | undefined): string {
  if (!step?.actedByName) return "";
  const capacity = step.actedAs && step.actedAs !== "primary" ? ` (${esc(step.actedAs)})` : "";
  return `${esc(step.actedByName)}${capacity}<br/><span style="font-weight:400;font-size:10px;">${fmtDate(step.actedAt)}</span>`;
}

/**
 * Builds the MS-SC/F7 printable HTML. Every field tolerates `undefined` —
 * orders created before these fields existed print blank ruled lines, not a
 * crash, since the form's whole job is to still work with a pen.
 */
export function buildOrderFormHtml(order: OrderFormData): string {
  const salesManagerStep = stepByKey(order.steps, "sales_manager_approval");
  const gmStep = stepByKey(order.steps, "general_manager_approval");

  const logo = logoDataUri();
  const logoCell = logo
    ? `<img src="${logo}" alt="Golden Wheat Mills" class="logo" />`
    : `<div class="company-name-fallback">Golden Wheat Mills</div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>Sales Order ${esc(order.orderNumber)}</title>
<style>
${fontFaces()}

@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: #fff; color: #000;
  font-family: "Thmanyah", Arial, Tahoma, sans-serif; font-size: 12px;
}
body { direction: rtl; }
html, body { height: 281mm; }
.page { width: 194mm; height: 281mm; margin: 0 auto; background: #fff; display: flex; flex-direction: column; }

table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 4px 6px; }
.section { margin-top: 8px; }
.bold { font-weight: 700; }
.ltr { direction: ltr; }
.text-left { text-align: left; }
.text-center { text-align: center; }
.text-right { text-align: right; }

.header-table { table-layout: fixed; height: 31mm; }
.header-table td { padding: 0; vertical-align: middle; }
.header-logo { width: 30%; text-align: center; }
.header-title { width: 40%; text-align: center; }
.header-company { width: 30%; text-align: center; direction: ltr; }
.logo { width: 72px; height: 72px; object-fit: contain; }
.company-name-fallback { font-size: 16px; font-weight: 700; }
.sales-order { font-size: 22px; font-weight: bold; direction: ltr; line-height: 1.25; }
.sales-order-ar { font-size: 20px; font-weight: bold; margin-top: 3px; }
.company-name { font-size: 18px; font-weight: bold; }

.serial-row { height: 9mm; display: flex; align-items: center; font-size: 13px; font-weight: bold; }
.serial-value { min-width: 45mm; display: inline-block; border-bottom: 1px dotted #000; margin-right: 5px; min-height: 16px; }

.info-table { table-layout: fixed; }
.info-table th { height: 8mm; font-size: 12px; background: #fafafa; text-align: center; }
.info-table td { height: 25mm; vertical-align: top; padding: 7px 9px; }
.info-line { display: flex; align-items: flex-end; gap: 4px; min-height: 18px; margin-bottom: 8px; }
.info-label { font-weight: bold; white-space: nowrap; }
.dotted-line { flex: 1; border-bottom: 1px dotted #000; min-height: 14px; }
.value { min-height: 14px; padding: 0 4px; }

.items-table { table-layout: fixed; }
.items-table thead th { background: #f8f8f8; font-weight: bold; text-align: center; height: 9mm; font-size: 11px; vertical-align: middle; }
.items-table tbody td { height: 7mm; padding: 2px 4px; text-align: center; }
.col-item { width: 21%; } .col-bags { width: 15%; } .col-requested { width: 17%; }
.col-delivered { width: 17%; } .col-bonus { width: 12%; } .col-notes { width: 18%; }

.payment-row { min-height: 11mm; display: flex; align-items: center; gap: 36px; padding: 4px 8px; font-size: 12px; }
.payment-title { font-weight: bold; margin-left: 10px; }
.check-option { display: flex; align-items: center; gap: 7px; font-weight: bold; }
.checkbox { width: 14px; height: 14px; border: 1px solid #000; display: inline-block; flex: 0 0 auto; position: relative; }
.checkbox.checked::after { content: "\\2713"; position: absolute; inset: 0; text-align: center; line-height: 12px; font-size: 13px; font-weight: bold; }

.notes-table { table-layout: fixed; }
.notes-table td { width: 50%; height: 31mm; padding: 6px 8px; vertical-align: top; }
.note-title { font-weight: bold; margin-bottom: 5px; }
.note-body { min-height: 30px; white-space: pre-wrap; }
.signature-inline { display: flex; align-items: flex-end; gap: 5px; margin-top: 6px; }

.approval-title { height: 10mm; display: flex; align-items: center; font-size: 13px; font-weight: bold; }
.approval-table { table-layout: fixed; }
.approval-table td { width: 50%; height: 22mm; vertical-align: top; padding: 8px 12px; font-weight: bold; font-size: 12px; }

.footer { margin-top: auto; padding-top: 7mm; }
.footer-table { direction: ltr; table-layout: fixed; font-size: 9px; font-weight: bold; }
.footer-table td { height: 6mm; text-align: center; padding: 2px 4px; }
.footer-page { width: 10%; } .footer-date { width: 32%; } .footer-issue { width: 30%; } .footer-form { width: 28%; }

/* Fidelity between the Chrome print preview and the Playwright/Puppeteer
   page.pdf() path: both rasterize @page + these rules identically as long
   as nothing depends on viewport size or animation. */
tr, td, th, table, .notes-table, .approval-table, .header-table, .items-table { break-inside: avoid; page-break-inside: avoid; }
.page { page-break-after: avoid; }
</style>
</head>
<body>
<div class="page">

  <table class="header-table">
    <tr>
      <td class="header-company"><div class="company-name">Golden Wheat Mills</div></td>
      <td class="header-title">
        <div class="sales-order">Sales Order</div>
        <div class="sales-order-ar">طلبية مبيعات</div>
      </td>
      <td class="header-logo">${logoCell}</td>
    </tr>
  </table>

  <div class="serial-row">
    <span>الرقم المتسلسل</span>
    <span class="serial-value">${esc(order.orderNumber)}</span>
  </div>

  <table class="info-table">
    <thead>
      <tr><th>معلومات الزبون</th><th>معلومات الطلبية</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="info-line">
            <span class="info-label">اسم الزبون / الوكيل:</span>
            <span class="dotted-line"><span class="value">${esc(order.customerAr || order.customer || "")}${order.agentName ? " / " + esc(order.agentName) : ""}</span></span>
          </div>
          <div class="info-line">
            <span class="info-label">العنوان:</span>
            <span class="dotted-line"><span class="value">${esc(order.customerAddress || "")}</span></span>
          </div>
        </td>
        <td>
          <div class="info-line">
            <span class="info-label">تاريخ الطلبية:</span>
            <span class="dotted-line"><span class="value">${fmtDate(order.orderDate)}</span></span>
          </div>
          <div class="info-line">
            <span class="info-label">اسم المندوب:</span>
            <span class="dotted-line"><span class="value">${esc(order.salesRepName || "")}</span></span>
          </div>
        </td>
      </tr>
    </tbody>
  </table>

  <div class="section">
    <table class="items-table">
      <thead>
        <tr>
          <th class="col-item">الصنف</th>
          <th class="col-bags">الكمية (طن)</th>
          <th class="col-requested">الوزن المطلوب (طن)</th>
          <th class="col-delivered">الوزن الفعلي (طن)</th>
          <th class="col-bonus">البونص (كيس)</th>
          <th class="col-notes">ملاحظات</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows(order.lines || [])}
      </tbody>
    </table>
  </div>

  <div class="payment-row">
    <span class="payment-title">طريقة الدفع / التسديد:</span>
    <span class="check-option">
      <span class="checkbox ${order.paymentMethod === "cash" ? "checked" : ""}"></span> نقدي
    </span>
    <span class="check-option">
      <span class="checkbox ${order.paymentMethod === "deferred" ? "checked" : ""}"></span> مؤجل
    </span>
  </div>

  <table class="notes-table">
    <tr>
      <td>
        <div class="note-title">ملاحظات دائرة التحصيلات :</div>
        <div class="note-body">${esc(order.collections?.note || "")}</div>
        <div class="signature-inline">
          <span class="bold">التوقيع:</span>
          <span class="dotted-line">${esc(order.collections?.byName || "")}</span>
        </div>
      </td>
      <td>
        <div class="note-title">ملاحظات قسم التعبئة :</div>
        <div class="note-body">${esc(order.packing?.note || "")}</div>
        <div class="signature-inline">
          <span class="bold">التوقيع:</span>
          <span class="dotted-line">${esc(order.packing?.byName || "")}</span>
        </div>
      </td>
    </tr>
  </table>

  <div class="approval-title">الموافقة على اعتماد الطلبية</div>
  <table class="approval-table">
    <tr>
      <td>توقيع مدير المبيعات :<br/><br/>${signatureCell(salesManagerStep)}</td>
      <td>توقيع المدير العام :<br/><br/>${signatureCell(gmStep)}</td>
    </tr>
  </table>

  <div class="footer">
    <table class="footer-table">
      <tr>
        <td class="footer-form">Form No. : MS-SC/F7</td>
        <td class="footer-issue">Issue No. : 1/0</td>
        <td class="footer-date">Issue Date: ${fmtDate(new Date())}</td>
        <td class="footer-page">1/1</td>
      </tr>
    </table>
  </div>

</div>
</body>
</html>`;
}
