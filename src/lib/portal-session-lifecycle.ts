import { db } from "@/lib/db";
import { snapshotPortalDayAsync } from "@/lib/portal-metrics";

const ACTIVE_ITEM_STATUSES = new Set(["DISCOVERED", "PROCESSING"]);

export async function syncScrapeSessionProgress(
  sessionId: string,
  trigger: string,
): Promise<void> {
  const completion = await db.$transaction(async (tx) => {
    const lockKey = `scrape-session:${sessionId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const session = await tx.scrapeSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        completedAt: true,
        portalId: true,
        createdAt: true,
      },
    });
    if (!session) return null;

    const groupedStatuses = await tx.trackedItem.groupBy({
      by: ["status"],
      where: { scrapeSessionId: sessionId },
      _count: { id: true },
    });
    const total = groupedStatuses.reduce((sum, entry) => sum + entry._count.id, 0);
    const active = groupedStatuses.reduce(
      (sum, entry) => sum + (ACTIVE_ITEM_STATUSES.has(entry.status) ? entry._count.id : 0),
      0,
    );
    const failed = groupedStatuses.find((entry) => entry.status === "ERROR")?._count.id ?? 0;
    const processed = total - active;
    const isListFailure = session.status === "FAILED" && total === 0;
    const isComplete = active === 0 && !isListFailure;
    const shouldUpdateLifecycle = session.status !== "CANCELLED" && !isListFailure;

    await tx.scrapeSession.update({
      where: { id: sessionId },
      data: {
        itemsFound: total,
        itemsProcessed: processed,
        ...(shouldUpdateLifecycle && {
          status: isComplete ? (failed > 0 ? "FAILED" : "COMPLETED") : "RUNNING",
          completedAt: isComplete ? (session.completedAt ?? new Date()) : null,
        }),
      },
    });

    return {
      shouldSnapshot: isComplete && session.status !== "CANCELLED" && !session.completedAt,
      portalId: session.portalId,
      createdAt: session.createdAt,
    };
  });

  if (completion?.shouldSnapshot) {
    snapshotPortalDayAsync(completion.portalId, completion.createdAt, trigger);
  }
}
