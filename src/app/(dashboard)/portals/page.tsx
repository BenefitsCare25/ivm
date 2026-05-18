export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Radar } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PortalList } from "@/components/portals/portal-list";
import { PortalDashboard } from "@/components/portals/portal-dashboard";
import type { PortalSummary } from "@/types/portal";

export default async function PortalsPage() {
  const session = await requireAuth();

  const portals = await db.portal.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      scrapeSessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, completedAt: true },
      },
      _count: {
        select: { scrapeSessions: true },
      },
    },
  });

  const portalIds = portals.map((p) => p.id);

  const [metricsSum, liveItemsSum, sessionsWithProgress] = portalIds.length > 0
    ? await Promise.all([
        db.portalDailyMetrics.groupBy({
          by: ["portalId"],
          where: { portalId: { in: portalIds } },
          _sum: { items: true },
        }),
        db.scrapeSession.groupBy({
          by: ["portalId"],
          where: { portalId: { in: portalIds } },
          _sum: { itemsFound: true },
        }),
        db.scrapeSession.findMany({
          where: {
            portalId: { in: portalIds },
            trackedItems: { some: { status: { in: ["DISCOVERED", "PROCESSING"] } } },
          },
          select: {
            portalId: true,
            _count: {
              select: {
                trackedItems: { where: { status: { in: ["DISCOVERED", "PROCESSING"] } } },
              },
            },
          },
        }),
      ])
    : [[], [], []];

  const portalItemCounts = new Map<string, number>();
  const metricsMap = new Map(metricsSum.map((r) => [r.portalId, r._sum.items ?? 0]));
  const liveMap = new Map(liveItemsSum.map((r) => [r.portalId, r._sum.itemsFound ?? 0]));
  for (const pid of portalIds) {
    portalItemCounts.set(pid, Math.max(metricsMap.get(pid) ?? 0, liveMap.get(pid) ?? 0));
  }
  for (const s of sessionsWithProgress) {
    const n = s._count.trackedItems;
    if (n > 0) portalItemCounts.set(s.portalId, (portalItemCounts.get(s.portalId) ?? 0) + n);
  }

  const enriched: PortalSummary[] = portals.map((p) => {
    const lastSession = p.scrapeSessions[0] ?? null;
    return {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      authMethod: p.authMethod,
      scheduleEnabled: p.scheduleEnabled,
      scheduleCron: p.scheduleCron,
      lastScrapeStatus: lastSession?.status ?? null,
      lastScrapeAt: lastSession?.completedAt?.toISOString() ?? null,
      totalItems: portalItemCounts.get(p.id) ?? 0,
      createdAt: p.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Portal Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Connect to web portals, scrape items, and compare with downloaded documents
          </p>
        </div>
        <Button asChild>
          <Link href="/portals/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Portal
          </Link>
        </Button>
      </div>

      <PortalDashboard />

      {enriched.length === 0 ? (
        <EmptyState
          icon={<Radar className="h-6 w-6 text-muted-foreground" />}
          title="No portals configured"
          description="Add a portal to start tracking items from web portals."
          action={
            <Button asChild>
              <Link href="/portals/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Portal
              </Link>
            </Button>
          }
        />
      ) : (
        <PortalList portals={enriched} />
      )}
    </div>
  );
}
