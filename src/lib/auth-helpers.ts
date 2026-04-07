import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UnauthorizedError } from "@/lib/errors";

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
