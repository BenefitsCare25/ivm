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

  const serialized = {
    id: portal.id,
    name: portal.name,
    baseUrl: portal.baseUrl,
    listPageUrl: portal.listPageUrl,
    authMethod: portal.authMethod,
    listSelectors: (portal.listSelectors ?? {}) as Record<string, unknown>,
    detailSelectors: (portal.detailSelectors ?? {}) as Record<string, unknown>,
    scheduleEnabled: portal.scheduleEnabled,
    scheduleCron: portal.scheduleCron,
    hasCredentials: !!portal.credential?.encryptedUsername,
    hasCookies: !!portal.credential?.cookieData,
    cookieExpiresAt: portal.credential?.cookieExpiresAt?.toISOString() ?? null,
    createdAt: portal.createdAt.toISOString(),
    updatedAt: portal.updatedAt.toISOString(),
    sessions: portal.scrapeSessions.map((s) => ({
      ...s,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return <PortalDetailView portal={serialized} />;
}
