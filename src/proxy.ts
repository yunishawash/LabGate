import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import type { NextRequest } from "next/server";

// Next 16 renamed `middleware` to `proxy`. There is no middleware.ts.
const { auth } = NextAuth(authConfig);

export function proxy(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return auth(request as any);
}

export const config = {
  // NOTE: `api` is excluded — API routes get NO ambient protection and must
  // each guard themselves (SPEC §3). This is deliberate and matches the CMMS.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
