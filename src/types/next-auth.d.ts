import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/types";

/**
 * Module augmentation so `session.user.role` is typed rather than cast at every
 * call site. The CMMS casts `(session?.user as { role?: string })` in ~20 places
 * because it never did this; LabGate does it once, here.
 *
 * Note the JWT target: `next-auth/jwt` is only `export * from "@auth/core/jwt"`,
 * and a re-export cannot be augmented — the interface has to be widened where it
 * is actually declared.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      permissions: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    permissions?: string[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    permissions?: string[];
  }
}

export {};
