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
  type ItemDetailJobData,
  type ItemDetailJobResult,
} from "@/lib/queue/item-detail-queue";
import type { DetailSelectors } from "@/types/portal";
import type { FieldComparison } from "@/types/portal";

async function processItemDetail(
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

    // Authenticate and navigate
    const { context, page } = await resolveAuth({
      credential: portal.credential,
      baseUrl: portal.baseUrl,
      listPageUrl: portal.listPageUrl,
    });

    try {
      // Scrape detail page fields
      const detailData = await scrapeDetailPage(page, item.detailPageUrl, detailSelectors);

      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { detailData: JSON.parse(JSON.stringify(detailData)) },
      });

      // Download attached files
      const storagePrefix = `portal-files/${portalId}/${trackedItemId}`;
      const downloadedFiles = await downloadFiles(page, detailSelectors, storagePrefix);

      // Save file records in bulk
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

      // Extract fields from downloaded PDFs using AI
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

      // Run AI comparison if we have both page data and PDF data
      let comparisonResult;
      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        comparisonResult = await compareFields({
          pageFields: detailData,
          pdfFields,
          provider,
          apiKey,
        });
      }

      // Save comparison result
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

      // Update item status
      const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { status: hasMismatch ? "FLAGGED" : "COMPARED" },
      });

      // Update scrape session progress
      await db.scrapeSession.update({
        where: { id: item.scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });

      return {
        status: "COMPLETED",
        mismatchCount: comparisonResult?.mismatchCount ?? 0,
      };
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
      where: {
        trackedItems: { some: { id: trackedItemId } },
      },
      data: { itemsProcessed: { increment: 1 } },
    });

    return { status: "FAILED", mismatchCount: 0, errorMessage };
  }
}

// Start the worker
const worker = startItemDetailWorker(processItemDetail);

if (worker) {
  logger.info("[worker] Item detail worker started");
} else {
  logger.warn("[worker] Redis not available, item detail worker not started");
}

process.on("SIGTERM", async () => {
  if (worker) await worker.close();
  await closeBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  if (worker) await worker.close();
  await closeBrowser();
  process.exit(0);
});
