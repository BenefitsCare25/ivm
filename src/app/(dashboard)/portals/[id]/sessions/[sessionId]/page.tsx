export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { TrackedItemsTable } from "@/components/portals/tracked-items-table";
import { ScrapeStatusBadge } from "@/components/portals/portal-status-badge";
import type { ScrapeSessionStatus } from "@/types/portal";

export default async function SessionItemsPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const session = await requireAuth();
  const { id, sessionId } = await params;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!portal) notFound();

  const scrapeSession = await db.scrapeSession.findFirst({
    where: { id: sessionId, portalId: id },
    include: {
      trackedItems: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          portalItemId: true,
          status: true,
          listData: true,
          detailPageUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { files: true },
          },
        },
      },
      _count: {
        select: { trackedItems: true },
      },
    },
  });
  if (!scrapeSession) notFound();

  const statusCounts = await db.trackedItem.groupBy({
    by: ["status"],
    where: { scrapeSessionId: sessionId },
    _count: { id: true },
  });

  const breakdown = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count.id])
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portals/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {portal.name}
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                Scrape Session
              </h1>
              <ScrapeStatusBadge status={scrapeSession.status as ScrapeSessionStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              {scrapeSession._count.trackedItems} items found &middot;{" "}
              {scrapeSession.itemsProcessed} processed
            </p>
          </div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(breakdown).map(([status, count]) => (
          <div
            key={status}
            className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs"
          >
            <span className="font-medium text-foreground">{count}</span>
            <span className="text-muted-foreground">{status}</span>
          </div>
        ))}
      </div>

      <TrackedItemsTable
        items={scrapeSession.trackedItems.map((item) => ({
          id: item.id,
          portalItemId: item.portalItemId,
          status: item.status,
          listData: (item.listData as Record<string, string>) ?? {},
          detailUrl: item.detailPageUrl,
          fileCount: item._count.files,
          comparisonCount: 0,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        }))}
        portalId={id}
        sessionId={sessionId}
      />
    </div>
  );
}
