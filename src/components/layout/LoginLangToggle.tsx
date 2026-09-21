"use client";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { type Lang, langCookieString } from "@/lib/lang";

/**
 * The login page has no AppShell (it renders before there is a session to
 * hand it — see the note in AppShell.tsx), so it cannot reach LangContext.
 * This is the standalone equivalent of the sidebar's language button: it
 * writes the same cookie and asks the router to re-render the current route,
 * which re-runs the root layout server-side with the new value.
 */
export function LoginLangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const next: Lang = lang === "en" ? "ar" : "en";

  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = langCookieString(next);
        router.refresh();
      }}
      className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
    >
      <Languages size={13} className="flex-shrink-0" />
      {lang === "en" ? "العربية" : "English"}
    </button>
  );
}
