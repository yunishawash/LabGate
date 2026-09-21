import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LANG_COOKIE, dirFor, langFromCookie } from "@/lib/lang";
import "./globals.css";

/** Dynamic, not a static export — the browser tab title follows the same
 *  language the page itself renders in, read from the same cookie as `dir`. */
export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const lang = langFromCookie(store.get(LANG_COOKIE)?.value);
  return lang === "ar"
    ? {
        title: "نظام المبيعات — مطاحن القمح الذهبية",
        description: "سير عمل اعتماد الطلبيات — الموافقات وفحوصات المختبر والترحيل",
      }
    : {
        title: "Sales System — Golden Wheat Mills",
        description: "Sample release workflow — approvals, lab testing and dispatch",
      };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read on the server, so `lang`/`dir` are correct in the first byte — no
  // client effect, no flash of the wrong direction, no hydration mismatch to
  // dodge. See src/lib/lang.ts for why this used to be a localStorage read.
  const store = await cookies();
  const lang = langFromCookie(store.get(LANG_COOKIE)?.value);

  return (
    <html lang={lang} dir={dirFor(lang)} className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
