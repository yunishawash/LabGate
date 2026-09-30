import fs from "fs";
import path from "path";
import { SALES_STAGES, type StageDef } from "@/lib/salesWorkflow";
import {
  ROLE_LABELS,
  LAB_STATUS_LABELS,
  LAB_DECISION_LABELS,
  type UserRole,
  type LabStatus,
  type LabDecision,
} from "@/types";

/** Shape this template actually reads — a lean SalesOrder plus its steps. */
export interface OrderFormLine {
  product?: string;
  productAr?: string;
  bagCount?: number;
  bagWeightKg?: number;
  lineWeightKg?: number;
  bonusBags?: number;
  note?: string;
  /** This line's own weighbridge reading — populated only once stage 8 has
   *  weighed this specific product, independently of every other line. */
  actualWeightKg?: number | null;
}

/** One parameter reading, shown exactly like the order screen's read-only
 *  "view readings" dialog — value + status, no limits (those are a Lab-module
 *  concern; this is "see what was entered"). */
export interface OrderFormLabResult {
  parameterId?: string;
  parameterName: string;
  unit?: string;
  value: number;
  status: "pass" | "warning" | "fail";
}

export interface OrderFormLabSample {
  sampleNumber: string;
  product?: string;
  sampleDate?: string | Date;
  testedByName?: string;
  overallStatus?: "pass" | "warning" | "fail";
  finalDecision?: "pending" | "accepted" | "rejected";
  results: OrderFormLabResult[];
  notes?: string;
}

export interface OrderFormStep {
  stageKey: string;
  stageIndex?: number;
  status?: string;
  actedByName?: string;
  actedAt?: string | Date | null;
  actedAs?: string;
  actedForRole?: string;
  actedForName?: string;
  note?: string;
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
  status?: string;
  currentStageIndex?: number;
  rejection?: { reason?: string; byName?: string; at?: string | Date | null };
  labOverallStatus?: string;
  totalWeightKg?: number;
  actualNetWeightKg?: number | null;
  variancePct?: number | null;
}

/** One audit-log row — the same feed the "History" tab reads, sorted the
 *  same way (newest first) so the printed log reads exactly like the screen. */
export interface OrderFormHistoryEntry {
  action: string;
  field?: string;
  performedByName?: string;
  notes?: string;
  timestamp?: string | Date;
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

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
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
        <td>${l.actualWeightKg != null ? fmtTons(l.actualWeightKg) : ""}</td>
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
  // Always the real signer's own name — "بالنيابة عن" only names WHO he stood
  // in for (the actual person, when known, not just the role's title), never
  // a raw internal value like "(delegate)".
  // Both names are Latin-script inside an RTL paragraph, sandwiching an
  // Arabic connector — without <bdi> isolation the bidi algorithm swaps their
  // VISUAL order (confirmed by rendering the actual PDF, not just reasoning
  // about the markup).
  const onBehalf =
    step.actedAs && step.actedAs !== "primary"
      ? ` بالنيابة عن <bdi>${esc(
          step.actedForName || (ROLE_LABELS[(step.actedForRole || "") as UserRole]?.ar ?? step.actedForRole)
        )}</bdi>`
      : "";
  return `<bdi>${esc(step.actedByName)}</bdi>${onBehalf}<br/><span style="font-weight:400;font-size:10px;">${fmtDate(step.actedAt)}</span>`;
}

type ChainState = "done" | "current" | "pending" | "rejected" | "skipped";

const CHAIN_BADGE_CLASS: Record<ChainState, string> = {
  done: "chain-badge-done",
  current: "chain-badge-current",
  pending: "chain-badge-pending",
  rejected: "chain-badge-rejected",
  skipped: "chain-badge-skipped",
};

const CHAIN_BADGE_LABEL: Record<ChainState, string> = {
  done: "معتمدة",
  current: "قيد الإجراء",
  pending: "بالانتظار",
  rejected: "مرفوضة",
  skipped: "متخطاة",
};

function chainState(
  steps: OrderFormStep[],
  index: number,
  currentStageIndex: number | undefined,
  status: string | undefined
): ChainState {
  const matching = steps.filter((s) => s.stageIndex === index);
  if (matching.some((s) => s.status === "rejected")) return "rejected";
  if (matching.length && matching.every((s) => s.status === "approved" || s.status === "completed")) return "done";
  if (matching.some((s) => s.status === "skipped")) return "skipped";
  if (index === currentStageIndex && status === "Pending") return "current";
  return "pending";
}

/** One signatory line under a chain stage: who, when, and in what capacity. */
function chainSignatureLine(stage: StageDef, step: OrderFormStep | undefined, indented: boolean): string {
  const roleLabel = ROLE_LABELS[stage.role as UserRole]?.ar ?? stage.role;
  const done = step?.status === "approved" || step?.status === "completed";

  let body: string;
  if (done) {
    // Both names are Latin-script inside an RTL paragraph, sandwiching an
    // Arabic connector — without <bdi> isolation the bidi algorithm swaps
    // their VISUAL order (confirmed by rendering the actual PDF).
    const capacity =
      step!.actedAs && step!.actedAs !== "primary"
        ? ` <span class="chain-capacity">· بالإنابة عن <bdi>${esc(
            step!.actedForName || (ROLE_LABELS[(step!.actedForRole || stage.role) as UserRole]?.ar ?? step!.actedForRole)
          )}</bdi></span>`
        : "";
    const when = step!.actedAt ? ` <span class="chain-muted">· ${fmtDateTime(step!.actedAt)}</span>` : "";
    body = `<bdi>${esc(step!.actedByName) || '<span class="chain-muted">مكتملة</span>'}</bdi>${capacity}${when}`;
  } else if (step?.status === "skipped") {
    body = '<span class="chain-muted">لم يتم الوصول إليها</span>';
  } else if (step?.status === "rejected") {
    body = '<span class="chain-rejected-text">رُفضت هنا</span>';
  } else {
    body = '<span class="chain-muted">بالانتظار</span>';
  }

  const note = step?.note
    ? `<div class="chain-note">${esc(step.note)}</div>`
    : "";

  return `
    <div class="chain-sig${indented ? " chain-sig-indented" : ""}">
      ${indented ? `<span class="chain-role">${esc(roleLabel)}</span>` : ""}
      <span>${body}</span>
    </div>
    ${note}`;
}

/** Builds the full approval-chain page — the same sequence shown on the
 *  order's "Approval chain" tab, laid out for print rather than a screen. */
function buildApprovalChainPage(order: OrderFormData): string {
  const steps = order.steps || [];

  const byIndex = new Map<number, StageDef[]>();
  for (const s of SALES_STAGES) {
    if (!byIndex.has(s.index)) byIndex.set(s.index, []);
    byIndex.get(s.index)!.push(s);
  }
  const indexes = [...byIndex.keys()].sort((a, b) => a - b);

  const rows = indexes
    .map((i) => {
      const stages = byIndex.get(i)!;
      const dual = stages.length > 1;
      const state = chainState(steps, i, order.currentStageIndex, order.status);
      const title = stages[0].groupAr ?? stages[0].ar;

      const signed = stages.filter((s) => {
        const st = stepByKey(steps, s.key)?.status;
        return st === "approved" || st === "completed";
      }).length;
      const dualBadge = dual
        ? `<span class="chain-badge ${signed === 2 ? "chain-badge-done" : "chain-badge-pending"}">${signed}/2 توقيع</span>`
        : "";

      const sigLines = stages
        .map((stage) => chainSignatureLine(stage, stepByKey(steps, stage.key), dual))
        .join("\n");

      const extra: string[] = [];
      if (i === 6 && order.labOverallStatus) {
        const key = (order.labOverallStatus in LAB_STATUS_LABELS ? order.labOverallStatus : "pass") as LabStatus;
        extra.push(`<div class="chain-extra"><span class="chain-badge chain-badge-lab">${esc(LAB_STATUS_LABELS[key].ar)}</span></div>`);
      }
      if (i === 8 && order.actualNetWeightKg != null) {
        const pct = order.variancePct ?? 0;
        extra.push(`
          <div class="chain-extra chain-weigh">
            <span class="chain-muted">المطلوب</span> ${fmtTons(order.totalWeightKg)} طن
            <span class="chain-muted">←</span>
            <span class="chain-muted">الفعلي</span> <span class="bold">${fmtTons(order.actualNetWeightKg)} طن</span>
            <span>(${pct > 0 ? "+" : ""}${pct}%)</span>
          </div>`);
      }

      return `
      <div class="chain-item">
        <div class="chain-head">
          <span class="chain-index">${i}/8</span>
          <span class="chain-stage-name">${esc(title)}</span>
          <span class="chain-badges">
            ${dualBadge}
            <span class="chain-badge ${CHAIN_BADGE_CLASS[state]}">${CHAIN_BADGE_LABEL[state]}</span>
          </span>
        </div>
        <div class="chain-body">
          ${sigLines}
        </div>
        ${extra.join("\n")}
      </div>`;
    })
    .join("\n");

  const rejectionBlock =
    order.status === "Rejected" && order.rejection
      ? `
      <div class="chain-rejection">
        <div class="chain-rejection-title">رفضها ${esc(order.rejection.byName || "")}</div>
        <div class="chain-rejection-reason">${esc(order.rejection.reason || "")}</div>
      </div>`
      : "";

  return `
  <div class="section">
    ${pageHeadHtml("Approval Chain", "سلسلة الاعتماد", order.orderNumber)}

    <div class="chain-list">
      ${rows}
    </div>

    ${rejectionBlock}
  </div>`;
}

/** The small header block (logo/title row + serial number) every secondary
 *  page opens with — kept in one place so page 2+ never drift from page 1's
 *  own hand-written header. */
function pageHeadHtml(
  titleEn: string,
  titleAr: string,
  orderNumber: string,
  badge?: string,
  pageNum?: number
): string {
  // A Western digit glued onto a title swallows a literal space before it
  // (the bidi algorithm reorders the digit run against that neutral space).
  // A digit-only <bdi> always resolves "ltr" (no strong char inside to pick
  // "rtl"), so the two titles need opposite physical margins: the English
  // title's number trails on the left, the Arabic title's number trails on
  // the right (the line itself still reads right-to-left, so the digit sits
  // at its far-left end, touching the Arabic text on its right).
  const numSuffixEn = pageNum != null ? `<bdi class="title-page-num-en">${pageNum}</bdi>` : "";
  const numSuffixAr = pageNum != null ? `<bdi class="title-page-num-ar">${pageNum}</bdi>` : "";
  return `
    <table class="header-table">
      <tr>
        <td class="header-company"><div class="company-name">Golden Wheat Mills</div></td>
        <td class="header-title">
          <div class="sales-order">${esc(titleEn)}${numSuffixEn}</div>
          <div class="sales-order-ar">${esc(titleAr)}${numSuffixAr}</div>
        </td>
        <td class="header-logo"></td>
      </tr>
    </table>

    <div class="serial-row">
      <span>الرقم المتسلسل</span>
      <span class="serial-value">${esc(orderNumber)}</span>
      ${badge ? `<span class="hist-page-badge">${esc(badge)}</span>` : ""}
    </div>`;
}

function footerHtml(page: number, total: number): string {
  return `
  <div class="footer">
    <table class="footer-table">
      <tr>
        <td class="footer-form">Form No. : MS-SC/F7</td>
        <td class="footer-issue">Issue No. : 1/0</td>
        <td class="footer-date">Issue Date: ${fmtDate(new Date())}</td>
        <td class="footer-page">${page}/${total}</td>
      </tr>
    </table>
  </div>`;
}

const ACTION_LABELS_AR: Record<string, string> = {
  created: "إنشاء الطلبية",
  updated: "تعديل الطلبية",
  stage_approved: "اعتماد مرحلة",
  stage_rejected: "رفض الطلبية",
  lab_attached: "إرفاق نتائج المختبر",
  weighed_posted: "الوزن والترحيل",
  collections_note: "تحديث الملاحظة",
  packing_note: "تحديث الملاحظة",
};

/** `field` is usually a stage key, but the Collections/Packing annotations
 *  (not a chain stage) stamp their own kind here instead — cover both rather
 *  than leaking the raw internal string onto a printed page. */
const FIELD_LABELS_AR: Record<string, string> = {
  collections: "دائرة التحصيلات",
  packing: "قسم التعبئة",
};

function historyStageLabel(field: string | undefined): string {
  if (!field) return "";
  const stage = SALES_STAGES.find((s) => s.key === field);
  if (stage) return stage.ar;
  return FIELD_LABELS_AR[field] ?? field;
}

function historyItemHtml(e: OrderFormHistoryEntry): string {
  const stageLabel = historyStageLabel(e.field);
  return `
    <div class="hist-item">
      <div class="hist-head">
        <bdi class="hist-date">${fmtDateTime(e.timestamp)}</bdi>
        <span class="hist-action">${esc(ACTION_LABELS_AR[e.action] ?? e.action)}${stageLabel ? ` <span class="chain-muted">· ${esc(stageLabel)}</span>` : ""}</span>
      </div>
      <div class="hist-by">${esc(e.performedByName || "")}</div>
      ${e.notes ? `<div class="hist-note">${esc(e.notes)}</div>` : ""}
    </div>`;
}

/** Rough printed height of one entry, in mm — long notes wrap onto several
 *  lines, and a page must stop accepting entries before that wrapping runs it
 *  past the physical sheet. Not exact layout, just enough to keep every
 *  history page inside its own A4 sheet for the common case. */
function estimateHistoryHeightMm(e: OrderFormHistoryEntry): number {
  const CHARS_PER_LINE = 85;
  const noteLines = e.notes ? Math.max(1, Math.ceil(e.notes.length / CHARS_PER_LINE)) : 0;
  return 13 + noteLines * 4.2;
}

/** Content budget for the entries area of a history page — the A4 sheet
 *  minus margins, header, serial row and footer. */
const HISTORY_PAGE_BUDGET_MM = 205;

function paginateHistory(entries: OrderFormHistoryEntry[]): OrderFormHistoryEntry[][] {
  const pages: OrderFormHistoryEntry[][] = [];
  let current: OrderFormHistoryEntry[] = [];
  let used = 0;
  for (const e of entries) {
    const h = estimateHistoryHeightMm(e);
    if (current.length && used + h > HISTORY_PAGE_BUDGET_MM) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(e);
    used += h;
  }
  if (current.length) pages.push(current);
  return pages;
}

/** One page per chunk, each numbered "صفحة N من M" against the log itself —
 *  on top of the document-wide "page/total" footer every page already carries. */
function buildHistoryPages(
  order: OrderFormData,
  chunks: OrderFormHistoryEntry[][],
  docPageStart: number,
  docPageTotal: number
): string {
  return chunks
    .map((chunk, i) => `
<div class="page page-break">
  <div class="section">
    ${pageHeadHtml("Activity Log", "سجل الحركات", order.orderNumber, `صفحة ${i + 1} من ${chunks.length}`)}

    <div class="hist-list">
      ${chunk.map(historyItemHtml).join("\n")}
    </div>
  </div>

  ${footerHtml(docPageStart + i, docPageTotal)}
</div>`)
    .join("\n");
}

const LAB_RESULT_BADGE_CLASS: Record<string, string> = {
  pass: "lab-badge-pass",
  warning: "lab-badge-warning",
  fail: "lab-badge-fail",
};

const LAB_DECISION_BADGE_CLASS: Record<string, string> = {
  accepted: "lab-badge-accepted",
  rejected: "lab-badge-rejected",
  pending: "lab-badge-pending",
};

/** One sample block — sample number, product, date, tested-by, overall
 *  status/sign-off, then the same value+status rows the order screen's
 *  read-only "view readings" dialog shows (no limits — that's a Lab-module
 *  concern). */
function labSampleItemHtml(s: OrderFormLabSample): string {
  const status = (s.overallStatus && s.overallStatus in LAB_STATUS_LABELS ? s.overallStatus : "pass") as LabStatus;
  const decision = s.finalDecision && s.finalDecision !== "pending" ? (s.finalDecision as LabDecision) : null;

  const rows = s.results
    .map((r) => {
      const rStatus = (r.status in LAB_STATUS_LABELS ? r.status : "pass") as LabStatus;
      return `
      <tr>
        <td class="col-param">${esc(r.parameterName)}${r.unit ? ` <span class="chain-muted">(${esc(r.unit)})</span>` : ""}</td>
        <td class="col-value">${esc(r.value)}</td>
        <td class="col-status"><span class="lab-badge ${LAB_RESULT_BADGE_CLASS[rStatus]}">${esc(LAB_STATUS_LABELS[rStatus].ar)}</span></td>
      </tr>`;
    })
    .join("\n");

  return `
    <div class="lab-item">
      <div class="lab-head">
        <span class="lab-sample-no">${esc(s.sampleNumber)}</span>
        ${s.product ? `<span class="lab-product">${esc(s.product)}</span>` : ""}
        <span class="lab-badges">
          <span class="lab-badge ${LAB_RESULT_BADGE_CLASS[status]}">${esc(LAB_STATUS_LABELS[status].ar)}</span>
          ${decision ? `<span class="lab-badge ${LAB_DECISION_BADGE_CLASS[decision]}">${esc(LAB_DECISION_LABELS[decision].ar)}</span>` : ""}
        </span>
      </div>
      <div class="lab-meta">
        ${fmtDate(s.sampleDate)}${s.testedByName ? ` <span class="chain-muted">· ${esc(s.testedByName)}</span>` : ""}
      </div>
      <table class="lab-table">
        <thead>
          <tr><th class="col-param">المعيار</th><th class="col-value">القيمة</th><th class="col-status">الحالة</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${s.notes ? `<div class="lab-notes">${esc(s.notes)}</div>` : ""}
    </div>`;
}

/** Rough printed height of one sample block, in mm — same purpose as
 *  estimateHistoryHeightMm: keep pagination inside the physical A4 sheet. */
function estimateLabSampleHeightMm(s: OrderFormLabSample): number {
  const notesLines = s.notes ? Math.max(1, Math.ceil(s.notes.length / 85)) : 0;
  return 18 + s.results.length * 5.5 + notesLines * 4.2;
}

function paginateLabSamples(samples: OrderFormLabSample[]): OrderFormLabSample[][] {
  const pages: OrderFormLabSample[][] = [];
  let current: OrderFormLabSample[] = [];
  let used = 0;
  for (const s of samples) {
    const h = estimateLabSampleHeightMm(s);
    if (current.length && used + h > HISTORY_PAGE_BUDGET_MM) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(s);
    used += h;
  }
  if (current.length) pages.push(current);
  return pages;
}

/** One page per chunk, laid out exactly like buildHistoryPages — the printed
 *  analog of the order screen's per-line "view readings" dialog, but for
 *  every sample attached to the order at once. */
function buildLabResultsPages(
  order: OrderFormData,
  chunks: OrderFormLabSample[][],
  docPageStart: number,
  docPageTotal: number
): string {
  return chunks
    .map((chunk, i) => `
<div class="page page-break">
  <div class="section">
    ${pageHeadHtml("Lab Results", "نتائج المختبر", order.orderNumber, undefined, i + 1)}

    <div class="lab-list">
      ${chunk.map(labSampleItemHtml).join("\n")}
    </div>
  </div>

  ${footerHtml(docPageStart + i, docPageTotal)}
</div>`)
    .join("\n");
}

/**
 * Builds the MS-SC/F7 printable HTML. Every field tolerates `undefined` —
 * orders created before these fields existed print blank ruled lines, not a
 * crash, since the form's whole job is to still work with a pen.
 */
export function buildOrderFormHtml(
  order: OrderFormData,
  history: OrderFormHistoryEntry[] = [],
  labSamples: OrderFormLabSample[] = []
): string {
  const salesManagerStep = stepByKey(order.steps, "sales_manager_approval");
  const gmStep = stepByKey(order.steps, "general_manager_approval");
  const financeManagerStep = stepByKey(order.steps, "finance_manager_approval");

  const labChunks = paginateLabSamples(labSamples);
  const historyChunks = paginateHistory(history);
  const totalPages = 2 + labChunks.length + historyChunks.length;

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
.title-page-num-en { margin-left: 6px; }
.title-page-num-ar { margin-right: 6px; }
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

.chain-list { margin-top: 4mm; }
.chain-item { border: 1px solid #000; border-radius: 4px; padding: 6px 10px; margin-bottom: 5px; }
.chain-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chain-index { font-size: 11px; color: #555; font-family: monospace; }
.chain-stage-name { font-weight: bold; font-size: 13px; }
.chain-badges { margin-inline-start: auto; display: flex; align-items: center; gap: 6px; }
.chain-badge { font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 9px; white-space: nowrap; }
.chain-badge-done { background: #d1fae5; color: #065f46; }
.chain-badge-current { background: #e0f2fe; color: #075985; }
.chain-badge-pending { background: #f1f5f9; color: #64748b; }
.chain-badge-rejected { background: #fee2e2; color: #991b1b; }
.chain-badge-skipped { background: #f1f5f9; color: #94a3b8; }
.chain-badge-lab { background: #dcfce7; color: #166534; }
.chain-body { margin-top: 3px; font-size: 12px; }
.chain-sig { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.chain-sig-indented { margin-inline-start: 6mm; margin-top: 2px; }
.chain-role { font-size: 11px; color: #555; min-width: 28mm; display: inline-block; }
.chain-muted { color: #64748b; }
.chain-capacity { color: #92400e; font-size: 11px; }
.chain-rejected-text { color: #991b1b; }
.chain-note { font-size: 11px; color: #555; font-style: italic; margin-top: 2px; }
.chain-extra { margin-top: 4px; font-size: 12px; }
.chain-weigh span { margin-inline-end: 4px; }
.chain-rejection { margin-top: 5mm; border: 1px solid #991b1b; border-radius: 4px; padding: 8px 10px; }
.chain-rejection-title { font-weight: bold; color: #991b1b; font-size: 13px; }
.chain-rejection-reason { color: #7f1d1d; font-size: 12px; margin-top: 3px; white-space: pre-wrap; }

.hist-page-badge { margin-inline-start: auto; font-size: 11px; font-weight: normal; color: #64748b; }
.hist-list { margin-top: 4mm; }
.hist-item { border-bottom: 1px solid #ccc; padding: 5px 2px; }
.hist-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.hist-date { font-size: 11px; color: #555; white-space: nowrap; }
.hist-action { font-weight: bold; font-size: 12px; }
.hist-by { font-size: 11px; color: #475569; margin-top: 2px; }
.hist-note { font-size: 11px; color: #334155; white-space: pre-wrap; margin-top: 2px; }

.lab-list { margin-top: 4mm; }
.lab-item { border: 1px solid #000; border-radius: 4px; padding: 6px 10px; margin-bottom: 5px; }
.lab-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lab-sample-no { font-weight: bold; font-size: 13px; font-family: monospace; }
.lab-product { font-size: 12px; color: #334155; }
.lab-badges { margin-inline-start: auto; display: flex; align-items: center; gap: 6px; }
.lab-badge { font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 9px; white-space: nowrap; }
.lab-badge-pass { background: #d1fae5; color: #065f46; }
.lab-badge-warning { background: #fef3c7; color: #92400e; }
.lab-badge-fail { background: #fee2e2; color: #991b1b; }
.lab-badge-accepted { background: #d1fae5; color: #065f46; }
.lab-badge-rejected { background: #fee2e2; color: #991b1b; }
.lab-badge-pending { background: #f1f5f9; color: #64748b; }
.lab-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
.lab-table { margin-top: 5px; table-layout: fixed; }
.lab-table th { background: #f8f8f8; font-size: 10px; text-align: center; height: 6mm; }
.lab-table td { font-size: 11px; padding: 2px 6px; text-align: center; height: 5.5mm; }
.lab-table .col-param { width: 46%; text-align: right; }
.lab-table .col-value { width: 24%; }
.lab-table .col-status { width: 30%; }
.lab-notes { font-size: 11px; color: #334155; white-space: pre-wrap; margin-top: 4px; }

/* Fidelity between the Chrome print preview and the Playwright/Puppeteer
   page.pdf() path: both rasterize @page + these rules identically as long
   as nothing depends on viewport size or animation. */
tr, td, th, table, .notes-table, .approval-table, .header-table, .items-table, .chain-item, .hist-item, .lab-item { break-inside: avoid; page-break-inside: avoid; }
.page { page-break-after: avoid; }
.page-break { page-break-before: always; }
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
          <span class="bold">توقيع المدير المالي:</span>
          ${
            financeManagerStep?.status === "approved" || financeManagerStep?.status === "completed"
              ? `<span>${signatureCell(financeManagerStep)}</span>`
              : `<span class="dotted-line"></span>`
          }
        </div>
      </td>
      <td>
        <div class="note-title">ملاحظات قسم التعبئة :</div>
        <div class="note-body">${esc(order.packing?.note || "")}</div>
        <div class="signature-inline">
          <span class="bold">توقيع المدير الفنّي:</span>
          <span class="dotted-line"></span>
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

  ${footerHtml(1, totalPages)}

</div>

<div class="page page-break">
  ${buildApprovalChainPage(order)}

  ${footerHtml(2, totalPages)}
</div>

${buildLabResultsPages(order, labChunks, 3, totalPages)}

${buildHistoryPages(order, historyChunks, 3 + labChunks.length, totalPages)}

</body>
</html>`;
}
