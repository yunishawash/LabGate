import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { connectDB } from "@/lib/mongoose";
import User from "@/models/User";

/**
 * Full (Node.js) NextAuth config — used by API routes, server components and
 * Server Actions. The proxy uses the Edge-safe `authConfig` instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await connectDB();

        // .lean() on purpose: NextAuth structured-clones whatever authorize()
        // returns, and a Mongoose document array is not cloneable — returning
        // `user.permissions` straight off a hydrated document fails at runtime
        // with `DataCloneError: [object Array] could not be cloned`.
        const user = (await User.findOne({
          email: String(credentials.email).toLowerCase().trim(),
          isActive: true,
        })
          .select("_id name email password role permissions")
          .lean()) as {
          _id: unknown;
          name: string;
          email: string;
          password?: string;
          role?: string;
          permissions?: string[];
        } | null;

        if (!user?.password) return null;

        const valid = await bcrypt.compare(String(credentials.password), user.password);
        if (!valid) return null;

        return {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: Array.from(user.permissions ?? []),
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        // Fresh sign-in.
        token.id = user.id;
        token.role = user.role;
        token.permissions = user.permissions ?? [];
      } else if (token.id) {
        // Re-read on every refresh so a role or permission change takes effect
        // without forcing the user to sign out — important here, because role
        // IS authority (SPEC §14.1).
        await connectDB();
        const fresh = (await User.findOne({ _id: token.id, isActive: true })
          .select("role permissions")
          .lean()) as { role?: string; permissions?: string[] } | null;
        if (fresh) {
          token.role = fresh.role;
          token.permissions = fresh.permissions ?? [];
        }
      }
      return token;
    },
  },
});
