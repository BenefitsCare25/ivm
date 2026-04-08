export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { FillStepClient } from "@/components/sessions/fill-step-client";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillActionSummary, FillReport, FillSessionData } from "@/types/fill";

function buildReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export default async function FillStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      mappingSets: {
        where: { status: "ACCEPTED" },
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
      fillActions: true,
    },
  });

  if (!fillSession) notFound();

  const targetAsset = fillSession.targetAssets[0];
  const mappingSet = fillSession.mappingSets[0];
  const hasPrerequisites = !!mappingSet;

  let initialData: FillSessionData | null = null;

  if (fillSession.fillActions.length > 0) {
    const mappings = mappingSet
      ? (mappingSet.mappings as unknown as FieldMapping[])
      : [];
    const targetFields = targetAsset
      ? (targetAsset.detectedFields as unknown as TargetField[])
      : [];

    const actions: FillActionSummary[] = fillSession.fillActions.map((fa) => {
      const tf = targetFields.find((f) => f.id === fa.targetFieldId);
      const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
      return {
        id: fa.id,
        targetFieldId: fa.targetFieldId,
        targetLabel: tf?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
        intendedValue: fa.intendedValue,
        appliedValue: fa.appliedValue,
        verifiedValue: fa.verifiedValue,
        status: fa.status as FillActionSummary["status"],
        errorMessage: fa.errorMessage,
      };
    });

    initialData = {
      actions,
      report: buildReport(actions),
      hasFilledDocument: !!targetAsset?.filledStoragePath,
      webpageFillScript: null,
    };
  }

  return (
    <FillStepClient
      sessionId={id}
      hasPrerequisites={hasPrerequisites}
      targetType={(targetAsset?.targetType as TargetType) ?? null}
      targetUrl={targetAsset?.url ?? null}
      initialData={initialData}
    />
  );
}
