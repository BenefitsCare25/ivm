"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/(auth)/sign-out/actions";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="w-full cursor-pointer"
      disabled={isPending}
      onClick={() => startTransition(() => signOutAction())}
    >
      <LogOut className="mr-2 h-4 w-4" />
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
