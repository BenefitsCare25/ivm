export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SourceStepClient } from "@/components/sessions/source-step-client";

export default async function SourceStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    include: {
      sourceAssets: {
        orderBy: { uploadedAt: "desc" },
        take: 1,
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          storagePath: true,
        },
      },
    },
  });

  if (!fillSession) notFound();

  const sourceAsset = fillSession.sourceAssets[0] ?? null;

  return <SourceStepClient sessionId={id} initialAsset={sourceAsset} />;
}
