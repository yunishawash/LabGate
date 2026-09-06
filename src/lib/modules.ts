/**
 * Module permissions. The route guard maps a URL's first segment straight to a
 * permission string (see auth.config.ts), so these names ARE the top-level
 * routes — keep them in sync with `src/app/(dashboard)/`.
 */
export const RESTRICTED_MODULES = [
  "orders",
  "lab",
  "customers",
  "reports",
  "users",
  "audit-log",
  "health",
] as const;

export type ModuleKey = (typeof RESTRICTED_MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, { en: string; ar: string }> = {
  orders:      { en: "Orders",      ar: "الطلبيات" },
  lab:         { en: "Lab",         ar: "المختبر" },
  customers:   { en: "Customers",   ar: "الزبائن" },
  reports:     { en: "Reports",     ar: "التقارير" },
  users:       { en: "Users",       ar: "المستخدمون" },
  "audit-log": { en: "Audit Trail", ar: "سجل التدقيق" },
  health:      { en: "System Health", ar: "صحة النظام" },
};

/** Routes every signed-in user may reach, with no permission needed. */
export const FREE_ROUTES = ["dashboard", "approvals", "sign-off", "rejections", "notifications"];

export const ALL_PERMISSIONS: string[] = [...RESTRICTED_MODULES];

/**
 * Where a signed-in user lands.
 *
 * Pure and dependency-free so auth.config.ts can use it on the Edge runtime.
 * Everyone goes to the dashboard because the dashboard itself is composed per
 * role (SPEC §10.0) — the weighbridge operator sees one block, the General
 * Manager sees seven. One destination, nine different screens.
 */
export function landingPathFor(_role: string, _permissions: string[] = []): string {
  return "/dashboard";
}

/** Does this user pass the module gate? Admins always do. */
export function canAccessModule(
  role: string,
  permissions: string[],
  segment: string
): boolean {
  if (!RESTRICTED_MODULES.includes(segment as ModuleKey)) return true;
  if (role === "admin") return true;
  return permissions.includes(segment);
}
