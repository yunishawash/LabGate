"use client";
import { useSession } from "next-auth/react";
import { ROLE_LABELS, type UserRole } from "@/types";
import { useLang } from "@/components/layout/AppShell";

/** Placeholder until step 10.1 builds the role-composed blocks (SPEC §10.0). */
export default function DashboardPage() {
  const { data: session } = useSession();
  const { lang, t } = useLang();
  const role = (session?.user?.role ?? "") as UserRole;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          {t("Dashboard", "لوحة التحكم")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            "Your day at a glance — what is waiting on you, and where everything stands.",
            "يومك بنظرة واحدة — شو بانتظارك، ووين وصلت الطلبيات."
          )}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 max-w-xl">
        <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-2.5">
          <dt className="text-slate-500">{t("Signed in as", "مسجّل الدخول")}</dt>
          <dd className="text-slate-900">{session?.user?.name}</dd>
          <dt className="text-slate-500">{t("Role", "الدور")}</dt>
          <dd className="text-slate-900">{ROLE_LABELS[role]?.[lang] ?? role}</dd>
          <dt className="text-slate-500">{t("Modules", "الوحدات")}</dt>
          <dd className="text-slate-900 font-mono text-xs break-words">
            {(session?.user?.permissions ?? []).join(" · ") || "—"}
          </dd>
        </dl>
      </div>

      <p className="text-sm text-slate-400">
        {t(
          "The role-composed blocks arrive in step 10.1.",
          "الكتل المركّبة حسب الدور بتيجي بالخطوة ١٠.١."
        )}
      </p>
    </div>
  );
}
