"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard, ClipboardList, CheckSquare, PenLine, FlaskConical,
  Users2, BarChart3, ScrollText, UserCog, Activity,
  Menu, X, Languages, LifeBuoy,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { canAccessModule } from "@/lib/modules";
import type { Lang } from "@/lib/lang";

interface NavItem {
  href: string;
  label: string;
  labelAr: string;
  icon: React.ReactNode;
  /** If set, requires this module permission. Unset = any signed-in user. */
  module?: string;
  /** Live count badge, filled in from /api/orders/queue at step 3.1. */
  badge?: "approvals" | "signOff" | "notifications";
}

/**
 * The nav is organised by WHAT YOU MUST DO, not by what the data is —
 * "Approvals" and "Results Sign-off" are separate destinations because they are
 * different jobs, done by different people, at different moments (SPEC §10.1).
 */
const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Dashboard",       labelAr: "لوحة التحكم",   icon: <LayoutDashboard size={18} /> },
  { href: "/orders",      label: "Orders Overview", labelAr: "الطلبيات",      icon: <ClipboardList   size={18} />, module: "orders" },
  { href: "/approvals",   label: "Approvals",       labelAr: "الاعتمادات",    icon: <CheckSquare     size={18} />, badge: "approvals" },
  { href: "/sign-off",    label: "Results Sign-off", labelAr: "اعتماد النتائج", icon: <PenLine        size={18} />, badge: "signOff" },
  { href: "/lab",         label: "Lab",             labelAr: "المختبر",       icon: <FlaskConical    size={18} />, module: "lab" },
  { href: "/customers",   label: "Customers",       labelAr: "الزبائن",       icon: <Users2          size={18} />, module: "customers" },
  { href: "/reports",     label: "Reports",         labelAr: "التقارير",      icon: <BarChart3       size={18} />, module: "reports" },
  // No `module`: everyone in the chain gets notified, so everyone needs the page.
  { href: "/notifications", label: "Notifications",  labelAr: "الإشعارات",     icon: <Bell            size={18} />, badge: "notifications" },
  { href: "/audit-log",   label: "Audit Trail",     labelAr: "سجل التدقيق",   icon: <ScrollText      size={18} />, module: "audit-log" },
  { href: "/users",       label: "Users",           labelAr: "المستخدمون",    icon: <UserCog         size={18} />, module: "users" },
  { href: "/health",      label: "System Health",   labelAr: "صحة النظام",    icon: <Activity        size={18} />, module: "health" },
];

interface SidebarProps {
  lang: Lang;
  onToggleLang: () => void;
  unreadCount?: number;
}

export function Sidebar({ lang, onToggleLang, unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();

  const role = session?.user?.role ?? "";
  const permissions = session?.user?.permissions ?? [];

  // Same rule the proxy applies to pages, so the nav can never show a link the
  // route guard would bounce — nor hide one an admin is allowed to open.
  const visibleNav = NAV.filter((item) =>
    item.module ? canAccessModule(role, permissions, item.module) : true
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const navContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
        <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-white/10 grid place-items-center overflow-hidden">
          <Image src="/logo.png" alt="Golden Wheat Mills" width={40} height={40} className="object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight truncate">
            {lang === "ar" ? "نظام المبيعات" : "Sales System"}
          </p>
          <p className="text-slate-400 text-xs truncate">
            {lang === "ar" ? "مطاحن القمح الذهبية" : "Golden Wheat Mills"}
          </p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        {visibleNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer",
              "text-slate-300 hover:text-white hover:bg-white/10",
              isActive(item.href) && "text-white bg-white/10 font-medium"
            )}
          >
            <span className="flex-shrink-0 relative">
              {item.icon}
              {item.badge === "notifications" && unreadCount > 0 && (
                <span className="absolute -top-1 -end-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            <span className="truncate">{lang === "ar" ? item.labelAr : item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-2 px-1 text-slate-400 text-xs">
          <LifeBuoy size={14} className="flex-shrink-0" />
          <span className="truncate">
            {lang === "ar" ? "هل تحتاج إلى مساعدة؟" : "Need help?"}
          </span>
        </div>
        <button
          onClick={onToggleLang}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm cursor-pointer font-medium"
        >
          <Languages size={16} className="flex-shrink-0" />
          {lang === "en" ? "العربية" : "English"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Logical properties only — `start-0` puts this on the right under dir="rtl"
          with no extra CSS. Never left-/right-. (SPEC §10.1) */}
      <aside
        className="hidden lg:flex flex-col w-64 fixed top-0 bottom-0 start-0 z-30"
        style={{ backgroundColor: "var(--sidebar-bg, #1a1d2e)" }}
      >
        {navContent}
      </aside>

      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 start-4 z-50 w-10 h-10 bg-slate-800 text-white rounded-lg flex items-center justify-center shadow-lg cursor-pointer"
        aria-label="Menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          onClick={() => setMobileOpen(false)}
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        />
      )}
      <aside
        className={cn(
          "lg:hidden fixed top-0 bottom-0 start-0 z-50 w-72 flex flex-col transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "rtl:translate-x-full ltr:-translate-x-full"
        )}
        style={{ backgroundColor: "var(--sidebar-bg, #1a1d2e)" }}
      >
        {navContent}
      </aside>
    </>
  );
}
