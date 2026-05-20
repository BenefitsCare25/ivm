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

  const [portals, metricsByPortal] = await Promise.all([
    db.portal.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        scrapeSessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, completedAt: true },
        },
      },
    }),
    db.portalDailyMetrics.groupBy({
      by: ["portalId"],
      where: { portal: { userId: session.user.id } },
      _sum: { items: true, compared: true, flagged: true, errors: true, skipped: true, verified: true },
    }),
  ]);

  const metricsMap = new Map(
    metricsByPortal.map((m) => [m.portalId, {
      totalFound: m._sum.items ?? 0,
      totalProcessed: (m._sum.compared ?? 0) + (m._sum.flagged ?? 0) + (m._sum.errors ?? 0)
        + (m._sum.skipped ?? 0) + (m._sum.verified ?? 0),
    }])
  );

  const enriched: PortalSummary[] = portals.map((p) => {
    const lastSession = p.scrapeSessions[0] ?? null;
    const metrics = metricsMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      authMethod: p.authMethod,
      scheduleEnabled: p.scheduleEnabled,
      scheduleCron: p.scheduleCron,
      lastScrapeStatus: lastSession?.status ?? null,
      lastScrapeAt: lastSession?.completedAt?.toISOString() ?? null,
      totalProcessed: metrics?.totalProcessed ?? 0,
      totalFound: metrics?.totalFound ?? 0,
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
