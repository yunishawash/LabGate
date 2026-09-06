import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

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
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-slate-900 text-white grid place-items-center mx-auto mb-4 text-lg font-semibold tracking-tight">
            LG
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">LabGate</h1>
          <p className="text-sm text-slate-500 mt-1">
            Golden Wheat Mills — <span dir="rtl">نظام المختبر</span>
          </p>
        </div>

        <form
          action={login}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
        >
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Incorrect email or password.
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <button
            type="submit"
            className="w-full h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
