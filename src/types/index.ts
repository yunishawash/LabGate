// ─────────────────────────────────────────────────────────────────────────────
// Shared types. Client interfaces use `string` for ObjectIds, matching what the
// API actually returns after JSON serialisation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles carry real authority here: they decide who may act on which stage of
 * the approval chain. Changing a user's role grants or revokes signing power,
 * which is why every role change is audited (SPEC §14.1).
 */
export type UserRole =
  | "admin"
  | "sales_coordinator"
  | "sales_manager"
  | "finance_manager"
  | "accountant"
  | "general_manager"
  | "technical_manager"
  | "lab_technician"
  | "weighbridge";

export const USER_ROLES: UserRole[] = [
  "admin",
  "sales_coordinator",
  "sales_manager",
  "finance_manager",
  "accountant",
  "general_manager",
  "technical_manager",
  "lab_technician",
  "weighbridge",
];

export const ROLE_LABELS: Record<UserRole, { en: string; ar: string }> = {
  admin:             { en: "Administrator",     ar: "مدير النظام" },
  sales_coordinator: { en: "Sales Coordinator", ar: "منسّق المبيعات" },
  sales_manager:     { en: "Sales Manager",     ar: "مدير المبيعات" },
  finance_manager:   { en: "Finance Manager",   ar: "المدير المالي" },
  accountant:        { en: "Accounts Officer",  ar: "المحاسب" },
  general_manager:   { en: "General Manager",   ar: "المدير العام" },
  technical_manager: { en: "Technical Manager", ar: "المدير التقني" },
  lab_technician:    { en: "Lab Technician",    ar: "فني المختبر" },
  weighbridge:       { en: "Weighbridge",       ar: "مشغّل الميزان" },
};

/** Colour per role, in the app's existing status language (SPEC §4). */
export const ROLE_BADGE: Record<UserRole, string> = {
  admin:             "bg-purple-100 text-purple-700",
  sales_coordinator: "bg-sky-100 text-sky-700",
  sales_manager:     "bg-blue-100 text-blue-700",
  finance_manager:   "bg-emerald-100 text-emerald-700",
  accountant:        "bg-teal-100 text-teal-700",
  general_manager:   "bg-purple-100 text-purple-700",
  technical_manager: "bg-indigo-100 text-indigo-700",
  lab_technician:    "bg-cyan-100 text-cyan-700",
  weighbridge:       "bg-orange-100 text-orange-700",
};

export interface IUser {
  _id: string;
  name: string;
  nameAr?: string;
  email: string;
  role: UserRole;
  permissions: string[];
  isActive: boolean;
  isAbsent: boolean;
  absentFrom?: string | null;
  absentTo?: string | null;
  absenceNote?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * The sack sizes the mill fills. Nothing else is accepted.
 *
 * 1 kg is the retail bag (nine products in the register carry it) and 40 kg is
 * a bran sack; both were missing, so those products could not be ordered at
 * the size they are actually sold in. Ascending, because the order dialog
 * renders this list as-is.
 */
export const BAG_WEIGHTS = [1, 10, 25, 30, 40, 50, 60] as const;
export type BagWeight = (typeof BAG_WEIGHTS)[number];

/**
 * How a line leaves the mill.
 *
 * `bagged` — filled sacks, counted. `bulk` — صبّ: the customer's truck is
 * parked at the loading point and the product poured straight in, so there is
 * nothing to count and the weight is the quantity. Every product supports
 * both; bran and wheat are simply the ones that usually go out loose.
 *
 * ⚠️ Keep the Arabic label as صبّ, not تعبئة. "التعبئة" is already two other
 * things in this system — the packing department whose notes sit on the same
 * printed sheet, and the items table's own column heading — so reusing it for
 * a line's loading method puts one word against three meanings on one page.
 * (Tried, and reverted, 2026-10-07.)
 */
export const LINE_PACKAGING = ["bagged", "bulk"] as const;
export type LinePackaging = (typeof LINE_PACKAGING)[number];

export const LINE_PACKAGING_LABELS: Record<LinePackaging, { en: string; ar: string }> = {
  bagged: { en: "Bagged",  ar: "أكياس" },
  bulk:   { en: "Bulk",    ar: "صبّ" },
};

/**
 * How far the weighed load may drift from the order before the weighbridge
 * operator has to say why, in percent.
 *
 * Shared so the dialog's warning, the server's requirement and the printed
 * certificate cannot disagree about where the line is.
 *
 * ⚠️ NOT the variance report's own threshold — that one lists orders beyond
 * ±1%, a deliberately looser net for "worth a look later". This is the
 * tighter "explain it now" line, and the two are allowed to differ because
 * they answer different questions.
 */
export const VARIANCE_TOLERANCE_PCT = 0.5;

export type SalesOrderStatus = "Pending" | "Posted" | "Rejected";

export const ORDER_STATUS_LABELS: Record<SalesOrderStatus, { en: string; ar: string }> = {
  Pending:  { en: "In progress", ar: "قيد الإجراء" },
  Posted:   { en: "Posted",      ar: "مرحّلة" },
  Rejected: { en: "Rejected",    ar: "مرفوضة" },
};

export const ORDER_STATUS_BADGE: Record<SalesOrderStatus, string> = {
  Pending:  "bg-amber-100 text-amber-700",
  Posted:   "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lab / QC — moved from the CMMS (SPEC §5). `ILabSample` gains the order link.
// ─────────────────────────────────────────────────────────────────────────────

export type LabOperator = "n_m_t" | "n_l_t" | "range" | "none";

export const LAB_OPERATOR_LABELS: Record<LabOperator, { en: string; ar: string }> = {
  n_m_t: { en: "Not more than", ar: "لا يتجاوز" },
  n_l_t: { en: "Not less than", ar: "لا يقل عن" },
  range: { en: "Range", ar: "نطاق" },
  none:  { en: "Informational", ar: "استرشادي" },
};

/** pass = comfortably in range · warning = in range but near a limit ·
 * fail = out of range. See src/lib/labQc.ts for the exact rule. */
export type LabStatus = "pass" | "warning" | "fail";

export const LAB_STATUS_LABELS: Record<LabStatus, { en: string; ar: string }> = {
  pass:    { en: "OK",            ar: "مطابق" },
  warning: { en: "Warning",       ar: "تحذير" },
  fail:    { en: "Out of range",  ar: "خارج النطاق" },
};

export type LabShift = "morning" | "afternoon" | "night" | "";

export const LAB_SHIFT_LABELS: Record<Exclude<LabShift, "">, { en: string; ar: string }> = {
  morning:   { en: "Morning",   ar: "صباحي" },
  afternoon: { en: "Afternoon", ar: "مسائي" },
  night:     { en: "Night",     ar: "ليلي" },
};

export type QcRating = "excellent" | "good" | "needs_attention";

export const QC_RATING_LABELS: Record<QcRating, { en: string; ar: string }> = {
  excellent:       { en: "Excellent",       ar: "ممتاز" },
  good:            { en: "Good",            ar: "جيد" },
  needs_attention: { en: "Needs attention", ar: "يحتاج متابعة" },
};

/** One row of the KPI dashboard — per product × parameter (optionally
 * scoped to a customer / date range). Mirrors /api/lab/stats. */
export interface ILabStatRow {
  productId: string;
  product: string;
  parameterId: string;
  parameterName: string;
  unit: string;
  count: number;
  average: number;
  stdDev: number | null;
  cvPct: number | null;
  minRecorded: number;
  maxRecorded: number;
  inSpecPct: number;
  rating: QcRating;
  target: number | null;
  min: number | null;
  max: number | null;
}

export interface ILabParameter {
  _id: string;
  name: string;
  nameAr?: string;
  unit: string;
  operator: LabOperator;
  defaultMin: number | null;
  defaultMax: number | null;
  /** Recommended value — not a pass/fail bound; drives deviation + chart line. */
  defaultTarget: number | null;
  /** The products this test applies to. EMPTY MEANS EVERY PRODUCT. */
  productIds: string[];
  order: number;
  isActive: boolean;
}

/** One pickable rejection reason. Admin-managed; see models/RejectionReason. */
export interface IRejectionReason {
  _id: string;
  label: string;
  labelAr?: string;
  order: number;
  isActive: boolean;
}

/**
 * A row of the product catalogue — a TYPE (نوع منتج) when `parentId` is null,
 * a GRADE (صنف) of that type otherwise. See models/LabProduct for why the two
 * share one collection.
 */
export interface ILabProduct {
  _id: string;
  name: string;
  nameAr?: string;
  parentId?: string | null;
  /** How many ACTIVE grades sit under this row. Computed by the API so no
   *  screen has to count them itself — and so "is this orderable" is one
   *  field rather than a derivation each caller gets to re-invent. */
  childCount?: number;
  /** Does an ORDER carrying this product have to pass stage 6? Not "can the
   *  lab test it" — see the field's note on the model. */
  orderRequiresLabTest: boolean;
  isActive: boolean;
}

/**
 * Can this row go on an order line, carry a spec sheet, or be sampled?
 *
 * Only a leaf. "طحين" names a category, not something the warehouse can fill
 * — you order Super. "نخالة" has nothing under it, so it is both the type and
 * the thing itself.
 *
 * `childCount` comes from the API; an undefined value means the caller is
 * holding a row from somewhere that does not compute it, and the permissive
 * answer is the safe one there — a product that cannot be selected anywhere
 * is a worse failure than one offered a level too high.
 */
export const isOrderableProduct = (p: ILabProduct): boolean => !p.childCount;

/**
 * Group a flat catalogue into `[type, grades[]]` pairs, ready to render as a
 * grouped picker.
 *
 * Lives here, beside the type, because four screens need the identical
 * grouping (the order dialog, the sample form, the specs screen, the lab step
 * dialog) and four hand-rolled copies of it would be four chances to disagree
 * about where a type with no grades belongs.
 *
 * A type with no grades appears as a group of one holding itself — the order
 * dialog then shows "نخالة" under the heading "نخالة", which reads as what it
 * is rather than as a missing level. Orphans (a grade whose type was
 * archived) are kept, under their own name, rather than silently dropped.
 */
export function groupProductsByType(
  products: ILabProduct[]
): { type: ILabProduct; grades: ILabProduct[] }[] {
  const byId = new Map(products.map((p) => [p._id, p]));
  const types = products.filter((p) => !p.parentId);
  const groups = new Map<string, { type: ILabProduct; grades: ILabProduct[] }>(
    types.map((t) => [t._id, { type: t, grades: [] }])
  );

  for (const p of products) {
    if (!p.parentId) {
      // A type with no grades is its own single option.
      if (!p.childCount) groups.get(p._id)!.grades.push(p);
      continue;
    }
    const group = groups.get(p.parentId);
    if (group) group.grades.push(p);
    else groups.set(p._id, { type: byId.get(p.parentId) ?? p, grades: [p] });
  }

  return Array.from(groups.values()).filter((g) => g.grades.length > 0);
}

/**
 * The catalogue as grouped picker options — every screen that asks a person to
 * choose a product uses this one.
 *
 * Only leaves are offered, each under its type's heading, because "طحين" is a
 * category and not something anyone can order, sample or hold a spec sheet
 * for. Six screens were each building this list their own way; six
 * derivations is six chances for one of them to go on offering a category
 * after this rule changes again.
 *
 * Returns the structural shape `Combobox` wants rather than importing its
 * type — this file is the domain vocabulary and must not depend on a widget.
 */
export function productPickerOptions(
  products: ILabProduct[],
  lang: "en" | "ar"
): { value: string; label: string; group: string }[] {
  const name = (p: ILabProduct) => (lang === "ar" && p.nameAr) || p.name;
  return groupProductsByType(products).flatMap(({ type, grades }) =>
    grades.filter(isOrderableProduct).map((g) => ({
      value: g._id,
      label: name(g),
      group: name(type),
    }))
  );
}

export interface ILabParameterThreshold {
  _id: string;
  parameterId: string;
  productId: string | { _id: string; name: string };
  min: number | null;
  max: number | null;
  target: number | null;
  operator?: LabOperator | null;
  isActive: boolean;
}

/** A parameter with its limits already resolved for one specific product —
 * what the product-centric spec editor and the entry form work with. */
export interface ILabProductSpec {
  parameterId: string;
  name: string;
  nameAr?: string;
  unit: string;
  order: number;
  /** Effective values (override if present, else parameter default). */
  min: number | null;
  max: number | null;
  target: number | null;
  operator: LabOperator;
  /** True when a per-product override row exists for this pair. */
  hasOverride: boolean;
  overrideId?: string | null;
}

/** A city a customer belongs to — its own collection so reports can group by
 *  it. See models/City. */
export interface ICity {
  _id: string;
  name: string;
  nameAr?: string;
  isActive: boolean;
}

export interface ILabCustomer {
  _id: string;
  name: string;
  nameAr?: string;
  code?: string;
  /** The office register's own number ("C0000032"). */
  customerNo?: string;
  /** Joined by the API, so a row can be displayed and grouped without a second
   *  lookup. A bare string on a payload the API did not join. */
  cityId?: string | ICity | null;
  salesRepNo?: string;
  accountOpenedAt?: string | null;
  idNumber?: string;
  phone?: string;
  contactName?: string;
  salesRepName?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
}

/** The customer table is plant-wide, not lab-owned. This alias says so at the
 *  call sites that have nothing to do with the lab. */
export type ICustomer = ILabCustomer;

export interface ILabSampleResult {
  parameterId: string;
  parameterName: string;
  unit: string;
  value: number;
  operator: LabOperator;
  min: number | null;
  max: number | null;
  target: number | null;
  deviation: number | null;
  status: LabStatus;
}

export interface ILabAttachment {
  _id?: string;
  fileName: string;
  url: string;
  fileType: string;
  size: number;
  uploadedAt: string;
  uploadedById?: string | null;
  uploadedByName?: string;
}

export type LabDecision = "pending" | "accepted" | "rejected";

export const LAB_DECISION_LABELS: Record<LabDecision, { en: string; ar: string }> = {
  pending:  { en: "Pending",  ar: "قيد الانتظار" },
  accepted: { en: "Accepted", ar: "مقبول" },
  rejected: { en: "Rejected", ar: "مرفوض" },
};

export interface ILabSample {
  _id: string;
  sampleNumber: string;
  /** Null for routine production QC — a sample without an order is normal and
   *  fully supported everywhere (SPEC §7). */
  orderId?: string | null;
  orderNumber?: string;
  productId: string;
  product: string;
  customerId?: string | null;
  customer: string;
  sampleDate: string;
  shift: LabShift;
  batchId: string;
  testedById: string;
  testedByName: string;
  results: ILabSampleResult[];
  overallStatus: LabStatus;
  attachments: ILabAttachment[];
  // Automatic overallStatus (above) is the threshold verdict; this is a
  // separate, optional human sign-off by the technical manager (admin-only
  // to set — enforced server-side).
  finalDecision: LabDecision;
  finalDecisionNote?: string;
  finalDecisionById?: string | null;
  finalDecisionByName?: string;
  finalDecisionAt?: string | null;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
