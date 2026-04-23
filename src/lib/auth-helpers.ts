import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  return session;
}

export async function requireAuthApi() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session;
}

export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "SUPER_ADMIN") redirect("/portals");
  return session;
}

export async function requireSuperAdminApi() {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();
  if (session.user.role !== "SUPER_ADMIN") throw new ForbiddenError();
  return session;
}
