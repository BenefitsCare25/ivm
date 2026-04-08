export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SessionStepper } from "@/components/sessions/session-stepper";
import type { SessionStep } from "@/types/session";

export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      currentStep: true,
      status: true,
    },
  });

  if (!fillSession) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">
        {fillSession.title}
      </h1>
      <SessionStepper
        sessionId={fillSession.id}
        currentStep={fillSession.currentStep as SessionStep}
        sessionStatus={fillSession.status}
      />
      {children}
    </div>
  );
}
