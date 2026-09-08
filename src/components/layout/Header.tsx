"use client";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Bell, LogOut } from "lucide-react";
import { ROLE_LABELS, type UserRole } from "@/types";
import { useLang } from "./AppShell";

/** Initials for the avatar chip — first letters of the first two words. */
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
}

export function Header({ unreadCount = 0 }: { unreadCount?: number }) {
  const { data: session } = useSession();
  const { lang, t } = useLang();
  const router = useRouter();

  const name = session?.user?.name ?? "";
  const role = (session?.user?.role ?? "") as UserRole;
  const roleLabel = ROLE_LABELS[role]?.[lang] ?? role;

  return (
    <header className="h-16 flex-shrink-0 bg-white border-b border-slate-200 flex items-center justify-end gap-3 px-4 md:px-6">
      <button
        onClick={() => router.push("/notifications")}
        className="relative w-9 h-9 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 grid place-items-center cursor-pointer"
        aria-label={t("Notifications", "الإشعارات")}
        title={t("Notifications", "الإشعارات")}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 end-1 min-w-4 h-4 px-1 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-slate-900 text-white grid place-items-center text-xs font-semibold flex-shrink-0">
          {initials(name)}
        </div>
        <div className="hidden sm:block min-w-0 leading-tight">
          <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
          {/* The role sits under the name on purpose: in a system where authority
              comes from role, nobody should have to guess which hat they wear. */}
          <p className="text-xs text-slate-500 truncate">{roleLabel}</p>
        </div>
      </div>

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="w-9 h-9 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 grid place-items-center cursor-pointer"
        aria-label={t("Sign out", "تسجيل الخروج")}
        title={t("Sign out", "تسجيل الخروج")}
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
