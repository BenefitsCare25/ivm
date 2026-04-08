export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { ExtractStepClient } from "@/components/sessions/extract-step-client";
import type { ExtractedField } from "@/types/extraction";

export default async function ExtractStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      sourceAssets: { select: { id: true }, take: 1 },
    },
  });

  if (!fillSession) notFound();

  const hasSource = fillSession.sourceAssets.length > 0;

  const extraction = await db.extractionResult.findFirst({
    where: { fillSessionId: id },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      documentType: true,
      fields: true,
      errorMessage: true,
    },
  });

  const initialExtraction = extraction
    ? {
        id: extraction.id,
        status: extraction.status,
        documentType: extraction.documentType,
        fields: extraction.fields as unknown as ExtractedField[],
        errorMessage: extraction.errorMessage,
      }
    : null;

  return (
    <ExtractStepClient
      sessionId={id}
      hasSource={hasSource}
      initialExtraction={initialExtraction}
    />
  );
}
