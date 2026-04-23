import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const providers = [
  Credentials({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const user = await db.user.findUnique({
        where: { email: credentials.email as string },
        select: { id: true, email: true, name: true, image: true, passwordHash: true, role: true },
      });

      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(
        credentials.password as string,
        user.passwordHash
      );

      if (!valid) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
      };
    },
  }),
  // Only register GitHub provider if credentials are configured
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? [GitHub({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      })]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Required for reverse-proxy (nginx) deployments
  // `@auth/prisma-adapter` returns `Adapter` from `@auth/core/adapters` while
  // NextAuth v5 beta's config expects its own internal `Adapter` type — the shapes
  // are compatible at runtime but the TypeScript types diverge. `as any` is the
  // standard workaround until the adapter ships a v5-native type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(db) as any,
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days (reduced from 30)
  },
  pages: {
    signIn: "/sign-in",
  },
  providers,
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role as UserRole;
        token.tokenVersion = 0;
        token.roleCheckedAt = Date.now();
      }

      // Periodic re-validation every 15 minutes: invalidate on tokenVersion mismatch or refresh role
      const now = Date.now();
      const lastCheck = (token.roleCheckedAt as number | undefined) ?? 0;
      if (token.id && (trigger === "update" || now - lastCheck > 15 * 60 * 1000)) {
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          select: { role: true, tokenVersion: true } as any,
        }) as { role: string; tokenVersion: number } | null;
        if (!dbUser) return null; // User deleted — invalidate token
        const storedVersion = token.tokenVersion as number | undefined;
        // Only invalidate if storedVersion is set (skip for tokens issued before this feature)
        if (storedVersion !== undefined && dbUser.tokenVersion !== storedVersion) return null;
        token.role = dbUser.role;
        token.tokenVersion = dbUser.tokenVersion;
        token.roleCheckedAt = now;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      const { logger } = await import("@/lib/logger");
      logger.info({ userId: user.id, email: user.email }, "[auth] User signed in");
    },
    async signOut() {
      const { logger } = await import("@/lib/logger");
      logger.info("[auth] User signed out");
    },
  },
});
