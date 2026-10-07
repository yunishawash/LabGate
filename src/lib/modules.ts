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
  // System-wide lists that decide how the chain behaves (rejection reasons
  // today). Nobody holds this permission by default — only `admin`, via the
  // bypass in `canAccessModule` — which is the client's rule for the
  // rejection-reason list expressed as a route gate rather than as a check
  // repeated in each handler.
  "settings",
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
  settings:    { en: "Settings",      ar: "إعدادات النظام" },
};

/** Routes every signed-in user may reach, with no permission needed. */
export const FREE_ROUTES = ["dashboard", "approvals", "sign-off", "rejections", "notifications"];

/**
 * Modules that CANNOT be granted to anyone — reachable only through the
 * `admin` bypass in `canAccessModule`.
 *
 * `settings` is here because the client's rule for the rejection-reason list
 * is "only the system administrator", and a grantable permission would make
 * that rule a lie in the one place it is configured. Leaving it grantable
 * would also produce a genuinely confusing screen: `GET` is open to any
 * signed-in user, so a non-admin holding the permission would see the list
 * render and then watch every change fail with a 403.
 */
export const UNGRANTABLE_MODULES: readonly ModuleKey[] = ["settings"];

/** The permissions an administrator may actually tick on a user. */
export const ALL_PERMISSIONS: string[] = RESTRICTED_MODULES.filter(
  (m) => !UNGRANTABLE_MODULES.includes(m)
);

/**
 * Where a signed-in user lands.
 *
 * Pure and dependency-free so auth.config.ts can use it on the Edge runtime.
 * Everyone goes to the dashboard because the dashboard itself is composed per
 * role (SPEC §10.0) — the weighbridge operator sees one block, the General
 * Manager sees seven. One destination, nine different screens.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- both are part
// of the signature every caller already passes; the body ignores them today
// because the dashboard composes itself per role.
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
