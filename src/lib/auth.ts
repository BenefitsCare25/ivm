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
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/sign-in",
  },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role as UserRole;
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
