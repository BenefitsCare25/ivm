export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { STEP_ROUTES } from "@/types/session";
import { requireAuth } from "@/lib/auth-helpers";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    select: { currentStep: true },
  });

  if (!fillSession) {
    notFound();
  }

  const stepRoute = STEP_ROUTES[fillSession.currentStep as keyof typeof STEP_ROUTES] ?? "source";
  redirect(`/sessions/${id}/${stepRoute}`);
}
