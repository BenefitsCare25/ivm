export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { ReviewStepClient } from "@/components/sessions/review-step-client";
import { buildFillReport, toFillActionSummary } from "@/types/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillSessionData } from "@/types/fill";
import type { AuditEventSummary } from "@/types/audit";
import type { SessionMetadataProps } from "@/components/sessions/session-metadata";

export default async function ReviewStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      sourceAssets: { orderBy: { uploadedAt: "desc" }, take: 1 },
      extractionResults: { where: { status: "COMPLETED" }, take: 1 },
      targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      mappingSets: {
        where: { status: "ACCEPTED" },
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
      fillActions: true,
      auditEvents: { orderBy: { timestamp: "asc" }, take: 100 },
    },
  });

  if (!fillSession) notFound();

  const sourceAsset = fillSession.sourceAssets[0] ?? null;
  const extraction = fillSession.extractionResults[0] ?? null;
  const targetAsset = fillSession.targetAssets[0] ?? null;
  const mappingSet = fillSession.mappingSets[0] ?? null;
  const hasFillActions = fillSession.fillActions.length > 0;

  const mappings = mappingSet
    ? (mappingSet.mappings as unknown as FieldMapping[])
    : [];

  let fillData: FillSessionData | null = null;
  if (hasFillActions) {
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];
    const actions = fillSession.fillActions.map((fa) =>
      toFillActionSummary(fa, targetFields, mappings)
    );
    fillData = {
      actions,
      report: buildFillReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
      webpageFillOperations: null,
    };
  }

  const auditEvents: AuditEventSummary[] = fillSession.auditEvents.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actor: e.actor,
    timestamp: e.timestamp.toISOString(),
    payload: e.payload as Record<string, unknown>,
  }));

  const extractedFields = extraction?.fields;
  const metadata: SessionMetadataProps = {
    sourceFileName: sourceAsset?.originalName ?? null,
    sourceMimeType: sourceAsset?.mimeType ?? null,
    targetType: targetAsset?.targetType ?? null,
    targetName: targetAsset?.url ?? targetAsset?.fileName ?? null,
    aiProvider: extraction?.provider ?? null,
    extractedFieldCount: Array.isArray(extractedFields)
      ? extractedFields.length
      : 0,
    mappedFieldCount: mappings.filter((m) => m.sourceFieldId !== null).length,
    fillTotal: fillData?.report.total ?? 0,
    fillVerified: fillData?.report.verified ?? 0,
    fillFailed: fillData?.report.failed ?? 0,
    createdAt: fillSession.createdAt.toISOString(),
    updatedAt: fillSession.updatedAt.toISOString(),
    status: fillSession.status,
  };

  return (
    <ReviewStepClient
      sessionId={id}
      hasPrerequisites={hasFillActions}
      targetType={(targetAsset?.targetType as TargetType) ?? null}
      sessionStatus={fillSession.status}
      fillData={fillData}
      auditEvents={auditEvents}
      metadata={metadata}
    />
  );
}
