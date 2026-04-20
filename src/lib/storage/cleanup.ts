import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const BASE_DIR = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
const PORTAL_FILES_DIR = path.join(BASE_DIR, "portal-files");
const PORTAL_EVENTS_DIR = path.join(BASE_DIR, "portal-events");
const RETENTION_DAYS = parseInt(process.env.SCRAPE_RETENTION_DAYS ?? "7", 10);

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results; // directory doesn't exist yet
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

async function removeEmptyDirs(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isDirectory()) {
      await removeEmptyDirs(full);
      // Try removing — fails silently if still has files
      await fs.rmdir(full).catch(() => {});
    }
  }
}

export async function runStorageCleanup(): Promise<{ deleted: number; freedBytes: number }> {
  // Collect all valid storage paths from DB
  const dbFiles = await db.trackedItemFile.findMany({
    select: { storagePath: true },
  });
  const validPaths = new Set(
    dbFiles.map((f) => path.normalize(path.join(BASE_DIR, f.storagePath)))
  );

  // Walk disk
  const diskFiles = await walkFiles(PORTAL_FILES_DIR);

  let deleted = 0;
  let freedBytes = 0;

  const now = Date.now();
  for (const filePath of diskFiles) {
    if (!validPaths.has(path.normalize(filePath))) {
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs < 60 * 60 * 1000) continue;
      const size = stat?.size ?? 0;
      await fs.unlink(filePath).catch((err) => {
        logger.warn({ filePath, err }, "[cleanup] Failed to delete orphan file");
      });
      deleted++;
      freedBytes += size;
      logger.debug({ filePath, size }, "[cleanup] Deleted orphan file");
    }
  }

  // Remove empty dirs left behind
  await removeEmptyDirs(PORTAL_FILES_DIR);

  logger.info(
    { deleted, freedMB: (freedBytes / 1024 / 1024).toFixed(2) },
    "[cleanup] Storage cleanup complete"
  );

  return { deleted, freedBytes };
}

/**
 * Retention-based cleanup: delete scrape sessions older than SCRAPE_RETENTION_DAYS.
 * Cascading deletes in Prisma remove TrackedItem, TrackedItemFile,
 * TrackedItemEvent, ComparisonResult, and ValidationResult automatically.
 * We collect file paths before deletion to remove from disk.
 */
export async function runRetentionCleanup(): Promise<{
  sessionsDeleted: number;
  filesDeleted: number;
  freedBytes: number;
}> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  logger.info(
    { retentionDays: RETENTION_DAYS, cutoff: cutoff.toISOString() },
    "[cleanup] Starting retention cleanup"
  );

  // Find sessions to purge
  const staleSessions = await db.scrapeSession.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true },
  });

  if (staleSessions.length === 0) {
    logger.info("[cleanup] No sessions older than retention period");
    return { sessionsDeleted: 0, filesDeleted: 0, freedBytes: 0 };
  }

  const sessionIds = staleSessions.map((s) => s.id);

  const [filesToDelete, screenshotsToDelete] = await Promise.all([
    db.trackedItemFile.findMany({
      where: { trackedItem: { scrapeSessionId: { in: sessionIds } } },
      select: { storagePath: true, sizeBytes: true },
    }),
    db.trackedItemEvent.findMany({
      where: {
        trackedItem: { scrapeSessionId: { in: sessionIds } },
        screenshotPath: { not: null },
      },
      select: { screenshotPath: true },
    }),
  ]);

  // Delete sessions (cascades to items, files, events, comparisons, validations)
  const { count: sessionsDeleted } = await db.scrapeSession.deleteMany({
    where: { id: { in: sessionIds } },
  });

  const allDeletions = [
    ...filesToDelete.map((f) => ({ path: path.join(BASE_DIR, f.storagePath), size: f.sizeBytes })),
    ...screenshotsToDelete
      .filter((e) => e.screenshotPath)
      .map((e) => ({ path: path.join(BASE_DIR, e.screenshotPath!), size: 0 })),
  ];

  await Promise.all(allDeletions.map((d) => fs.unlink(d.path).catch(() => {})));

  const filesDeleted = allDeletions.length;
  const freedBytes = allDeletions.reduce((sum, d) => sum + d.size, 0);

  // Clean empty directories under portal-files and portal-events
  await removeEmptyDirs(PORTAL_FILES_DIR);
  await removeEmptyDirs(PORTAL_EVENTS_DIR);

  logger.info(
    {
      sessionsDeleted,
      filesDeleted,
      freedMB: (freedBytes / 1024 / 1024).toFixed(2),
    },
    "[cleanup] Retention cleanup complete"
  );

  return { sessionsDeleted, filesDeleted, freedBytes };
}

/**
 * Combined cleanup: retention purge first, then orphan scan.
 */
export async function runFullCleanup(): Promise<{
  retention: { sessionsDeleted: number; filesDeleted: number; freedBytes: number };
  orphan: { deleted: number; freedBytes: number };
}> {
  const retention = await runRetentionCleanup();
  const orphan = await runStorageCleanup();
  return { retention, orphan };
}
