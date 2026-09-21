import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { LANG_COOKIE, langFromCookie } from "@/lib/lang";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hand the session AND the language down so the client shell renders
  // correctly on first paint — no signed-out flash, no wrong-language flash.
  const [session, store] = await Promise.all([auth(), cookies()]);
  const initialLang = langFromCookie(store.get(LANG_COOKIE)?.value);
  return (
    <AppShell initialSession={session} initialLang={initialLang}>
      {children}
    </AppShell>
  );
}
