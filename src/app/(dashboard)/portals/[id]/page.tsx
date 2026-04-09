export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PortalDetailView } from "@/components/portals/portal-detail-view";

export default async function PortalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
    include: {
      credential: {
        select: {
          cookieData: true,
          cookieExpiresAt: true,
          encryptedUsername: true,
        },
      },
      scrapeSessions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          triggeredBy: true,
          itemsFound: true,
          itemsProcessed: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!portal) notFound();

  // Item status counts per session
  const sessionItemCounts = await db.trackedItem.groupBy({
    by: ["scrapeSessionId", "status"],
    where: { scrapeSession: { portalId: id } },
    _count: { id: true },
  });

  const itemCountsMap = sessionItemCounts.reduce<
    Record<string, Record<string, number>>
  >((acc, row) => {
    if (!acc[row.scrapeSessionId]) acc[row.scrapeSessionId] = {};
    acc[row.scrapeSessionId][row.status] = row._count.id;
    return acc;
  }, {});

  // Derive available fields
  const listSelectors = (portal.listSelectors ?? {}) as Record<string, unknown>;
  const detailSelectors = (portal.detailSelectors ?? {}) as Record<string, unknown>;
  const listColumns = (listSelectors.columns as Array<{ name: string }> | undefined) ?? [];
  const detailFieldKeys = Object.keys(
    (detailSelectors.fieldSelectors as Record<string, unknown> | undefined) ?? {}
  );

  // Prefer actual scraped item field names over selector config
  const recentItems = await db.trackedItem.findMany({
    where: { scrapeSession: { portalId: id } },
    select: { listData: true, detailData: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const scrapedFields = new Set<string>();
  for (const item of recentItems) {
    Object.keys((item.listData as Record<string, unknown>) ?? {}).forEach((k) => scrapedFields.add(k));
    Object.keys((item.detailData as Record<string, unknown>) ?? {}).forEach((k) => scrapedFields.add(k));
  }

  const selectorFields = [
    ...listColumns.map((c) => c.name),
    ...detailFieldKeys,
  ];
  const availableFields = scrapedFields.size > 0
    ? [...scrapedFields].sort()
    : [...new Set(selectorFields)];

  const serialized = {
    id: portal.id,
    name: portal.name,
    baseUrl: portal.baseUrl,
    listPageUrl: portal.listPageUrl,
    authMethod: portal.authMethod,
    listSelectors,
    detailSelectors,
    scheduleEnabled: portal.scheduleEnabled,
    scheduleCron: portal.scheduleCron,
    hasCredentials: !!portal.credential?.encryptedUsername,
    hasCookies: !!portal.credential?.cookieData,
    cookieExpiresAt: portal.credential?.cookieExpiresAt?.toISOString() ?? null,
    createdAt: portal.createdAt.toISOString(),
    updatedAt: portal.updatedAt.toISOString(),
    groupingFields: (portal.groupingFields ?? []) as string[],
    availableFields,
    sessions: portal.scrapeSessions.map((s) => ({
      ...s,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      itemStatusCounts: itemCountsMap[s.id] ?? {},
    })),
  };

  return <PortalDetailView portal={serialized} />;
}
