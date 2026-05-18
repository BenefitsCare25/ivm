import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { toSGTDateStr } from "@/lib/utils";

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

export async function backfillPortalMetrics(userId?: string): Promise<{ days: number; portals: number }> {
  const sessions = await db.scrapeSession.findMany({
    where: userId ? { portal: { userId } } : undefined,
    select: { portalId: true, createdAt: true },
  });

  const pairs = new Set<string>();
  for (const s of sessions) {
    pairs.add(`${s.portalId}:${toSGTDateStr(s.createdAt)}`);
  }

  const portalsSeen = new Set<string>();
  await Promise.all(
    [...pairs].map((key) => {
      const [portalId, date] = key.split(":");
      portalsSeen.add(portalId);
      return snapshotPortalDay(portalId, date);
    })
  );

  logger.info({ days: pairs.size, portals: portalsSeen.size }, "[metrics] Backfill complete");
  return { days: pairs.size, portals: portalsSeen.size };
}
