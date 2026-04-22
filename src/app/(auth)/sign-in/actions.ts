"use server"

import { signIn } from "@/lib/auth"
import { AuthError } from "next-auth"

export async function credentialsLogin(
  email: string,
  password: string,
): Promise<{ error: string } | undefined> {
  try {
    await signIn("credentials", { email, password, redirectTo: "/" })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" }
    }
    // Re-throw for Next.js to handle NEXT_REDIRECT on success
    throw error
  }
}
