import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export function toSGTDateStr(utcDate: Date): string {
  const sgt = new Date(utcDate.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().split("T")[0];
}

/**
 * Recompute and upsert the daily metrics snapshot for a portal on a given SGT date.
 * Called after a session's last item reaches terminal status.
 */
export async function snapshotPortalDay(portalId: string, date: string): Promise<void> {
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(`${date}T23:59:59.999+08:00`);

  const sessions = await db.scrapeSession.findMany({
    where: { portalId, createdAt: { gte: start, lte: end } },
    select: {
      id: true,
      trackedItems: {
        select: { status: true, _count: { select: { files: true } } },
      },
    },
  });

  let items = 0, compared = 0, flagged = 0, errors = 0, skipped = 0, verified = 0, requireDoc = 0, files = 0;

  for (const s of sessions) {
    for (const item of s.trackedItems) {
      items++;
      files += item._count.files;
      switch (item.status) {
        case "COMPARED":    compared++;    break;
        case "FLAGGED":     flagged++;     break;
        case "ERROR":       errors++;      break;
        case "SKIPPED":     skipped++;     break;
        case "VERIFIED":    verified++;    break;
        case "REQUIRE_DOC": requireDoc++;  break;
      }
    }
  }

  await db.portalDailyMetrics.upsert({
    where: { portalId_date: { portalId, date } },
    create: { portalId, date, sessions: sessions.length, items, compared, flagged, errors, skipped, verified, requireDoc, files },
    update: { sessions: sessions.length, items, compared, flagged, errors, skipped, verified, requireDoc, files },
  });

  logger.debug({ portalId, date, items, sessions: sessions.length }, "[metrics] Portal daily snapshot saved");
}

/**
 * Backfill all existing sessions into PortalDailyMetrics.
 * Safe to run multiple times (upsert semantics).
 */
export async function backfillPortalMetrics(): Promise<{ days: number; portals: number }> {
  const sessions = await db.scrapeSession.findMany({
    select: { portalId: true, createdAt: true },
  });

  // Collect unique (portalId, date) pairs
  const pairs = new Set<string>();
  for (const s of sessions) {
    const date = toSGTDateStr(s.createdAt);
    pairs.add(`${s.portalId}:${date}`);
  }

  let count = 0;
  const portalsSeen = new Set<string>();

  for (const key of pairs) {
    const [portalId, date] = key.split(":");
    await snapshotPortalDay(portalId, date);
    portalsSeen.add(portalId);
    count++;
  }

  logger.info({ days: count, portals: portalsSeen.size }, "[metrics] Backfill complete");
  return { days: count, portals: portalsSeen.size };
}
