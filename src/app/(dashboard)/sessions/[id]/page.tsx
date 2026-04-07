import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

const STEP_ROUTES: Record<string, string> = {
  SOURCE: "source",
  EXTRACT: "extract",
  TARGET: "target",
  MAP: "map",
  FILL: "fill",
  REVIEW: "review",
};

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

  const stepRoute = STEP_ROUTES[fillSession.currentStep] ?? "source";
  redirect(`/sessions/${id}/${stepRoute}`);
}
