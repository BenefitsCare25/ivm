export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ItemDetailView } from "@/components/portals/item-detail-view";
import { ItemStatusBadge } from "@/components/portals/portal-status-badge";
import type { TrackedItemStatus, ComparisonFieldStatus } from "@/types/portal";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string; itemId: string }>;
}) {
  const session = await requireAuth();
  const { id, sessionId, itemId } = await params;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!portal) notFound();

  const item = await db.trackedItem.findFirst({
    where: { id: itemId, scrapeSessionId: sessionId },
    include: {
      files: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          downloadedAt: true,
        },
      },
      comparisonResult: {
        select: {
          id: true,
          provider: true,
          matchCount: true,
          mismatchCount: true,
          summary: true,
          fieldComparisons: true,
          completedAt: true,
        },
      },
    },
  });
  if (!item) notFound();

  const comparison = item.comparisonResult;
  const fields = (comparison?.fieldComparisons ?? []) as Array<{
    fieldName: string;
    pageValue: string | null;
    pdfValue: string | null;
    status: ComparisonFieldStatus;
    confidence: number;
    notes?: string;
  }>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/portals/${id}/sessions/${sessionId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Items
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">
              {item.portalItemId || `Item ${item.id.slice(0, 8)}`}
            </h1>
            <ItemStatusBadge status={item.status as TrackedItemStatus} />
          </div>
          <p className="text-sm text-muted-foreground">{portal.name}</p>
        </div>
      </div>

      <ItemDetailView
        item={{
          id: item.id,
          portalItemId: item.portalItemId,
          status: item.status as TrackedItemStatus,
          listData: (item.listData as Record<string, string>) ?? {},
          detailData: (item.detailData as Record<string, string>) ?? null,
          detailUrl: item.detailPageUrl,
          files: item.files.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            downloadedAt: f.downloadedAt?.toISOString() ?? null,
          })),
          comparison: comparison
            ? {
                id: comparison.id,
                provider: comparison.provider,
                matchCount: comparison.matchCount,
                mismatchCount: comparison.mismatchCount,
                summary: comparison.summary,
                fields,
                createdAt: comparison.completedAt?.toISOString() ?? "",
              }
            : null,
        }}
        portalId={id}
        sessionId={sessionId}
      />
    </div>
  );
}
