import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "intelligence-tampering" });

interface TamperingCheckResult {
  isTampered: boolean;
  previousHash: string | null;
  currentHash: string;
  fileName: string;
}

/**
 * Detects file tampering by comparing the SHA-256 hash of a newly downloaded file
 * against the hash stored from a previous scrape of the same portal item.
 *
 * A TAMPERING ValidationResult is written when hashes differ.
 * Always non-fatal — never throws.
 */
export async function checkTampering(
  trackedItemId: string,
  portalId: string,
  portalItemId: string,
  fileName: string,
  currentHash: string
): Promise<TamperingCheckResult> {
  const result: TamperingCheckResult = {
    isTampered: false,
    previousHash: null,
    currentHash,
    fileName,
  };

  try {
    // Find the most recent previous file with the same name from the same portal item
    const previous = await db.trackedItemFile.findFirst({
      where: {
        originalName: fileName,
        fileHash: { not: null },
        trackedItem: {
          id: { not: trackedItemId },
          portalItemId,
          scrapeSession: { portalId },
        },
      },
      orderBy: { downloadedAt: "desc" },
      select: { fileHash: true },
    });

    if (!previous?.fileHash) return result;

    result.previousHash = previous.fileHash;
    result.isTampered = previous.fileHash !== currentHash;

    if (result.isTampered) {
      await db.validationResult.create({
        data: {
          trackedItemId,
          ruleType: "TAMPERING",
          status: "FAIL",
          message: `File "${fileName}" content has changed since the last scrape — possible tampering detected`,
          metadata: JSON.parse(
            JSON.stringify({
              fileName,
              currentHash: currentHash.slice(0, 16),
              previousHash: previous.fileHash.slice(0, 16),
              portalItemId,
            })
          ),
        },
      });

      log.warn(
        { trackedItemId, portalItemId, fileName },
        "[tampering] File change detected"
      );
    }
  } catch (err) {
    log.warn({ err, trackedItemId, fileName }, "[tampering] Check failed (non-fatal)");
  }

  return result;
}
