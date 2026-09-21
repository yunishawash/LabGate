import { signIn } from "@/lib/auth";
import Image from "next/image";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LANG_COOKIE, langFromCookie } from "@/lib/lang";
import { LoginLangToggle } from "@/components/layout/LoginLangToggle";

/**
 * Sign-in is a Server Action, never `signIn()` from `next-auth/react` on the
 * client: the client helper needs a reachable origin and fails offline and
 * cross-origin. The plant server runs offline. (SPEC §3.4)
 */
async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      // "/" is routed to the right landing page by auth.config.ts::authorized,
      // which knows the signed-in user's role. Never hard-code a page here.
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e; // re-throw NEXT_REDIRECT
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, store] = await Promise.all([searchParams, cookies()]);
  const lang = langFromCookie(store.get(LANG_COOKIE)?.value);
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);

  // The email/password fields themselves stay LTR regardless of UI language —
  // an email address read right-to-left is the one place bilingual hurts
  // rather than helps (same convention as UserDialog's email/password inputs).
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-slate-900 grid place-items-center mx-auto mb-4 overflow-hidden">
            <Image src="/logo.png" alt="Golden Wheat Mills" width={56} height={56} className="object-contain" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {t("Sales System", "نظام المبيعات")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("Golden Wheat Mills", "مطاحن القمح الذهبية")}
          </p>
        </div>

        <form
          action={login}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
        >
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {t("Incorrect email or password.", "البريد الإلكتروني أو كلمة المرور غير صحيحة.")}
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              {t("Email", "البريد الإلكتروني")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              required
              autoComplete="username"
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              {t("Password", "كلمة المرور")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              dir="ltr"
              required
              autoComplete="current-password"
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <button
            type="submit"
            className="w-full h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer"
          >
            {t("Sign in", "تسجيل الدخول")}
          </button>
        </form>

        <div className="mt-4 flex justify-center">
          <LoginLangToggle lang={lang} />
        </div>
      </div>
    </main>
  );
}
