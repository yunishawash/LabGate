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
  accountant:        { en: "Accounts Officer",  ar: "مسؤول الحسابات" },
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

/** The five real sack sizes the mill fills. Nothing else is accepted. */
export const BAG_WEIGHTS = [10, 25, 30, 50, 60] as const;
export type BagWeight = (typeof BAG_WEIGHTS)[number];

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
  order: number;
  isActive: boolean;
}

export interface ILabProduct {
  _id: string;
  name: string;
  nameAr?: string;
  isActive: boolean;
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

export interface ILabCustomer {
  _id: string;
  name: string;
  nameAr?: string;
  code?: string;
  phone?: string;
  contactName?: string;
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
