export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { MapStepClient } from "@/components/sessions/map-step-client";
import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";

export default async function MapStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const [fillSession, mappingSet] = await Promise.all([
    db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        extractionResults: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
        targetAssets: {
          orderBy: { inspectedAt: "desc" },
          take: 1,
        },
      },
    }),
    db.mappingSet.findFirst({
      where: { fillSessionId: id },
      orderBy: { proposedAt: "desc" },
    }),
  ]);

  if (!fillSession) notFound();

  const extraction = fillSession.extractionResults[0];
  const targetAsset = fillSession.targetAssets[0];

  const extractedFields = extraction
    ? (extraction.fields as unknown as ExtractedField[])
    : [];
  const targetFields = targetAsset
    ? (targetAsset.detectedFields as unknown as TargetField[])
    : [];

  const hasPrerequisites =
    extractedFields.length > 0 && targetFields.length > 0;

  const initialMapping = mappingSet
    ? {
        id: mappingSet.id,
        status: mappingSet.status,
        mappings: mappingSet.mappings as unknown as FieldMapping[],
      }
    : null;

  return (
    <MapStepClient
      sessionId={id}
      hasPrerequisites={hasPrerequisites}
      extractedFields={extractedFields}
      targetFields={targetFields}
      initialMapping={initialMapping}
    />
  );
}
