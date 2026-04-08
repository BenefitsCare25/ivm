export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { FillStepClient } from "@/components/sessions/fill-step-client";
import { buildFillReport, toFillActionSummary } from "@/types/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillSessionData } from "@/types/fill";

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

    const actions = fillSession.fillActions.map((fa) =>
      toFillActionSummary(fa, targetFields, mappings)
    );

    initialData = {
      actions,
      report: buildFillReport(actions),
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
