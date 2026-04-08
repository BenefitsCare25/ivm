import { getPortalScrapeQueue } from "./portal-scrape-queue";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Syncs BullMQ repeatable jobs with portal schedule configurations.
 * Call on app/worker startup to restore scheduled scrapes.
 */
export async function syncPortalSchedules(): Promise<void> {
  const queue = getPortalScrapeQueue();
  if (!queue) {
    logger.warn("[scheduler] Redis not available, skipping schedule sync");
    return;
  }

  const scheduledPortals = await db.portal.findMany({
    where: { scheduleEnabled: true, scheduleCron: { not: null } },
    select: { id: true, userId: true, scheduleCron: true },
  });

  // Remove all existing repeatable jobs first to avoid duplicates
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Add current schedules
  for (const portal of scheduledPortals) {
    await addPortalSchedule(portal.id, portal.userId, portal.scheduleCron!);
  }

  logger.info(
    { count: scheduledPortals.length },
    "[scheduler] Portal schedules synced"
  );
}

export async function addPortalSchedule(
  portalId: string,
  userId: string,
  cron: string
): Promise<void> {
  const queue = getPortalScrapeQueue();
  if (!queue) return;

  await queue.add(
    "scheduled-scrape",
    { portalId, scrapeSessionId: "", userId },
    {
      repeat: { pattern: cron },
      jobId: `scheduled:${portalId}`,
    }
  );

  logger.info({ portalId, cron }, "[scheduler] Portal schedule added");
}

export async function removePortalSchedule(portalId: string): Promise<void> {
  const queue = getPortalScrapeQueue();
  if (!queue) return;

  const repeatable = await queue.getRepeatableJobs();
  const match = repeatable.find((j) => j.id === `scheduled:${portalId}`);
  if (match) {
    await queue.removeRepeatableByKey(match.key);
    logger.info({ portalId }, "[scheduler] Portal schedule removed");
  }
}
