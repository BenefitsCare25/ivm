export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { TargetStepClient } from "@/components/sessions/target-step-client";
import type { TargetField } from "@/types/target";

export default async function TargetStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      extractionResults: {
        where: { status: "COMPLETED" },
        take: 1,
        select: { id: true },
      },
      targetAssets: {
        orderBy: { inspectedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!fillSession) notFound();

  const hasExtraction = fillSession.extractionResults.length > 0;
  const targetAsset = fillSession.targetAssets[0] ?? null;

  const initialTarget = targetAsset
    ? {
        id: targetAsset.id,
        targetType: targetAsset.targetType as "WEBPAGE" | "PDF" | "DOCX",
        url: targetAsset.url,
        fileName: targetAsset.fileName,
        detectedFields: targetAsset.detectedFields as unknown as TargetField[],
        fieldCount: (targetAsset.detectedFields as unknown as unknown[]).length,
        isSupported: targetAsset.isSupported,
        unsupportedReason: targetAsset.unsupportedReason,
        inspectedAt: targetAsset.inspectedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <TargetStepClient
      sessionId={id}
      hasExtraction={hasExtraction}
      initialTarget={initialTarget}
    />
  );
}
