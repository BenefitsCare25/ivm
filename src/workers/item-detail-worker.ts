import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeDetailPage, downloadFiles } from "@/lib/playwright/scraper";
import { closeBrowser } from "@/lib/playwright/browser";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { extractFieldsFromDocument } from "@/lib/ai";
import { compareFields } from "@/lib/ai/comparison";
import {
  startItemDetailWorker,
  enqueueItemDetailBatch,
  type ItemDetailJobData,
  type ItemDetailJobResult,
} from "@/lib/queue/item-detail-queue";
import { scheduleStorageCleanup, startCleanupWorker } from "@/lib/queue/cleanup-queue";
import { runStorageCleanup } from "@/lib/storage/cleanup";
import type { DetailSelectors } from "@/types/portal";

// Hard cap per job — prevents hung Playwright or AI calls from blocking a slot indefinitely
const JOB_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms)
    ),
  ]);
}

async function processItemDetailCore(
  job: Job<ItemDetailJobData>
): Promise<ItemDetailJobResult> {
  const { trackedItemId, portalId, userId } = job.data;

  await db.trackedItem.update({
    where: { id: trackedItemId },
    data: { status: "PROCESSING" },
  });

  try {
    const item = await db.trackedItem.findUniqueOrThrow({
      where: { id: trackedItemId },
      include: {
        scrapeSession: {
          include: { portal: { include: { credential: true } } },
        },
      },
    });

    const portal = item.scrapeSession.portal;
    const detailSelectors = portal.detailSelectors as DetailSelectors;

    if (!item.detailPageUrl) {
      throw new Error("No detail page URL available");
    }

    const { context, page } = await resolveAuth({
      credential: portal.credential,
      baseUrl: portal.baseUrl,
      listPageUrl: portal.listPageUrl,
    });

    try {
      const detailData = await scrapeDetailPage(page, item.detailPageUrl, detailSelectors);

      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { detailData: JSON.parse(JSON.stringify(detailData)) },
      });

      const storagePrefix = `portal-files/${portalId}/${trackedItemId}`;
      const downloadedFiles = await downloadFiles(page, detailSelectors, storagePrefix);

      if (downloadedFiles.length > 0) {
        await db.trackedItemFile.createMany({
          data: downloadedFiles.map((file) => ({
            trackedItemId,
            fileName: file.fileName,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            storagePath: file.storagePath,
          })),
        });
      }

      const { provider, apiKey } = await resolveProviderAndKey(userId);
      const pdfFields: Record<string, string> = {};

      for (const file of downloadedFiles) {
        if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) {
          try {
            const { getStorageAdapter } = await import("@/lib/storage");
            const storage = getStorageAdapter();
            const fileBuffer = await storage.download(file.storagePath);

            const extraction = await extractFieldsFromDocument({
              sourceAssetId: trackedItemId,
              mimeType: file.mimeType,
              fileData: fileBuffer,
              fileName: file.originalName,
              provider,
              apiKey,
            });

            for (const field of extraction.fields) {
              pdfFields[field.label] = field.value;
            }
          } catch (err) {
            logger.warn({ err, fileName: file.originalName }, "[worker] Failed to extract from file");
          }
        }
      }

      let comparisonResult;
      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        comparisonResult = await compareFields({
          pageFields: detailData,
          pdfFields,
          provider,
          apiKey,
        });
      }

      if (comparisonResult) {
        await db.comparisonResult.create({
          data: {
            trackedItemId,
            provider,
            fieldComparisons: JSON.parse(JSON.stringify(comparisonResult.fieldComparisons)),
            matchCount: comparisonResult.matchCount,
            mismatchCount: comparisonResult.mismatchCount,
            summary: comparisonResult.summary,
            completedAt: new Date(),
          },
        });
      }

      const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { status: hasMismatch ? "FLAGGED" : "COMPARED" },
      });

      await db.scrapeSession.update({
        where: { id: item.scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });

      return { status: "COMPLETED", mismatchCount: comparisonResult?.mismatchCount ?? 0 };
    } finally {
      await context.close();
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, trackedItemId }, "[worker] Item detail processing failed");

    await db.trackedItem.update({
      where: { id: trackedItemId },
      data: { status: "ERROR", errorMessage },
    });

    await db.scrapeSession.updateMany({
      where: { trackedItems: { some: { id: trackedItemId } } },
      data: { itemsProcessed: { increment: 1 } },
    });

    return { status: "FAILED", mismatchCount: 0, errorMessage };
  }
}

async function processItemDetail(
  job: Job<ItemDetailJobData>
): Promise<ItemDetailJobResult> {
  return withTimeout(
    processItemDetailCore(job),
    JOB_TIMEOUT_MS,
    `item:${job.data.trackedItemId}`
  );
}

async function recoverStuckItems(): Promise<void> {
  const stuck = await db.trackedItem.findMany({
    where: { status: "PROCESSING" },
    select: {
      id: true,
      scrapeSession: {
        select: {
          portalId: true,
          portal: { select: { userId: true } },
        },
      },
    },
  });

  if (stuck.length === 0) return;

  logger.warn({ count: stuck.length }, "[worker] Recovering stuck PROCESSING items");

  await db.trackedItem.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "DISCOVERED", errorMessage: null },
  });

  await enqueueItemDetailBatch(
    stuck.map((item) => ({
      trackedItemId: item.id,
      portalId: item.scrapeSession.portalId,
      userId: item.scrapeSession.portal.userId,
    }))
  );
}

async function handleFinalFailure(
  job: Job<ItemDetailJobData>,
  err: Error
): Promise<void> {
  try {
    await db.trackedItem.updateMany({
      where: { id: job.data.trackedItemId, status: "PROCESSING" },
      data: { status: "ERROR", errorMessage: err.message },
    });
  } catch (dbErr) {
    logger.error({ dbErr, trackedItemId: job.data.trackedItemId }, "[worker] Failed to update ERROR status on final failure");
  }
}

// Startup recovery then start the worker
recoverStuckItems().catch((err) =>
  logger.error({ err }, "[worker] Startup recovery failed")
);

const worker = startItemDetailWorker(processItemDetail, handleFinalFailure);

if (worker) {
  logger.info("[worker] Item detail worker started");
} else {
  logger.warn("[worker] Redis not available, item detail worker not started");
}

// Schedule 24h storage cleanup + start cleanup worker
scheduleStorageCleanup().catch((err) =>
  logger.error({ err }, "[worker] Failed to schedule storage cleanup")
);

const cleanupWorker = startCleanupWorker(runStorageCleanup);
if (cleanupWorker) {
  logger.info("[worker] Storage cleanup worker started");
}

process.on("SIGTERM", async () => {
  if (worker) await worker.close();
  if (cleanupWorker) await cleanupWorker.close();
  await closeBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  if (worker) await worker.close();
  if (cleanupWorker) await cleanupWorker.close();
  await closeBrowser();
  process.exit(0);
});
