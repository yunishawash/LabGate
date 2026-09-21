"use client";
import { createContext, useContext, useState } from "react";
import type { Session } from "next-auth";
import { AuthProvider } from "./AuthProvider";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useUnreadCount } from "@/lib/useUnreadCount";
import { type Lang, langCookieString } from "@/lib/lang";

/**
 * Bilingual context. No i18n library — call sites carry both literals inline:
 *   t("Orders", "الطلبيات")
 * This is the CMMS's convention and it is deliberate: there are no keys and no
 * catalogues to drift out of sync with the screens.
 */
export type { Lang };

interface LangCtx {
  lang: Lang;
  t: (en: string, ar: string) => string;
  /** Charts do not mirror on their own — every chart takes this flag (SPEC §11.1). */
  isRtl: boolean;
}

export const LangContext = createContext<LangCtx>({
  lang: "en",
  t: (en) => en,
  isRtl: false,
});

export function useLang() {
  return useContext(LangContext);
}

/** Convenience for chart components, so no chart can forget to mirror. */
export function useChartDirection() {
  const { isRtl } = useLang();
  return isRtl;
}

export function AppShell({
  children,
  initialSession,
  initialLang,
}: {
  children: React.ReactNode;
  initialSession: Session | null;
  /** Read server-side from the cookie (src/lib/lang.ts) by the dashboard
   *  layout, so first paint is already correct — no client-side discovery,
   *  no flash of the wrong language or direction. AppShell mounts only for
   *  signed-in routes; the login page reads the same cookie directly and
   *  renders its own strings without this context (src/app/login/page.tsx). */
  initialLang: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  // Only opens a stream once there is somebody to open it for — an
  // unauthenticated EventSource would reconnect against a 401 forever.
  const { unread: unreadCount } = useUnreadCount(!!initialSession?.user);

  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);

  const toggleLang = () => {
    const next: Lang = lang === "en" ? "ar" : "en";
    setLang(next);
    // The DOM attributes are set immediately (no reload needed to see the
    // toggle take effect); the cookie is what makes the NEXT navigation and
    // the NEXT cold load start in this language server-side.
    document.documentElement.setAttribute("lang", next);
    document.documentElement.setAttribute("dir", next === "ar" ? "rtl" : "ltr");
    document.cookie = langCookieString(next);
  };

  return (
    <AuthProvider session={initialSession}>
      <LangContext.Provider value={{ lang, t, isRtl: lang === "ar" }}>
        <div className="min-h-screen flex">
          <Sidebar lang={lang} onToggleLang={toggleLang} unreadCount={unreadCount} />
          <div className="flex-1 flex flex-col lg:ms-64 min-w-0">
            <Header unreadCount={unreadCount} />
            <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </LangContext.Provider>
    </AuthProvider>
  );
}
