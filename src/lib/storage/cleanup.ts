import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const BASE_DIR = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
const PORTAL_FILES_DIR = path.join(BASE_DIR, "portal-files");

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

  for (const filePath of diskFiles) {
    if (!validPaths.has(path.normalize(filePath))) {
      const stat = await fs.stat(filePath).catch(() => null);
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
