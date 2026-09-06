import type { NextAuthConfig } from "next-auth";
import { canAccessModule, landingPathFor } from "@/lib/modules";
import type { UserRole } from "@/types";

/**
 * Edge-safe half of the NextAuth config: NO database imports, `providers: []`.
 * This is what `src/proxy.ts` instantiates. The full config with the Credentials
 * provider lives in `src/lib/auth.ts` and runs on Node.
 *
 * Consequence worth knowing: the proxy uses the `jwt` callback BELOW, not the
 * DB-refreshing one in auth.ts. Role changes therefore reach API routes and
 * server components immediately, and the proxy on the next token refresh.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },

  /**
   * ⚠️ Cookies ignore port numbers. LabGate on :3001 and the CMMS on :3000 share
   * one cookie jar on localhost, and BOTH default to `authjs.session-token` —
   * so without these distinct names, logging into one silently destroys the
   * other's session and looks like random logouts nobody can reproduce.
   * See SPEC §1. `secure` is env-driven for the same reason as §19.4: `true`
   * over plain HTTP drops the cookie and login appears to do nothing.
   */
  cookies: {
    sessionToken: {
      name: "labgate.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production" && process.env.AUTH_URL?.startsWith("https"),
      },
    },
    callbackUrl: { name: "labgate.callback-url" },
    csrfToken: { name: "labgate.csrf-token" },
  },

  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const role = auth?.user?.role ?? "";
      const permissions = auth?.user?.permissions ?? [];
      const home = () => landingPathFor(role, permissions);

      if (pathname === "/login") {
        if (isLoggedIn) return Response.redirect(new URL(home(), nextUrl));
        return true;
      }

      if (!isLoggedIn) return Response.redirect(new URL("/login", nextUrl));

      // "/" is a router, not a page.
      if (pathname === "/") return Response.redirect(new URL(home(), nextUrl));

      // A URL's first segment IS the permission name (SPEC §3).
      const segment = pathname.split("/")[1] ?? "";
      if (!canAccessModule(role, permissions, segment)) {
        return Response.redirect(new URL(home(), nextUrl));
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.permissions = user.permissions ?? [];
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id ?? "";
      session.user.role = (token.role ?? "") as UserRole;
      session.user.permissions = token.permissions ?? [];
      return session;
    },
  },
};
