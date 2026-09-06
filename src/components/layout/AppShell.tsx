"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "next-auth";
import { AuthProvider } from "./AuthProvider";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

/**
 * Bilingual context. No i18n library — call sites carry both literals inline:
 *   t("Orders", "الطلبيات")
 * This is the CMMS's convention and it is deliberate: there are no keys and no
 * catalogues to drift out of sync with the screens.
 */
export type Lang = "en" | "ar";

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

const LANG_KEY = "labgate-lang"; // NOT "cmms-lang" — same origin, different app

export function AppShell({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: Session | null;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const [unreadCount] = useState(0); // wired to SSE in step 9.2

  useEffect(() => {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null;
    if (stored === "ar" || stored === "en") setLang(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const toggleLang = () => setLang((l) => (l === "en" ? "ar" : "en"));

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
