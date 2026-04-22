import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeDetailPage, downloadFiles } from "@/lib/playwright/scraper";
import { closeBrowser } from "@/lib/playwright/browser";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { fetchDocTypes } from "@/lib/intelligence";
import type { DocTypeRecord } from "@/lib/intelligence";
import { emitItemEvent, emitFailureEvent, withEventTracking } from "@/lib/portal-events";
import {
  startItemDetailWorker,
  type ItemDetailJobData,
  type ItemDetailJobResult,
} from "@/lib/queue/item-detail-queue";
import { scheduleStorageCleanup, startCleanupWorker } from "@/lib/queue/cleanup-queue";
import { runCrossItemChecks } from "@/lib/validations/cross-item";
import { runFullCleanup } from "@/lib/storage/cleanup";
import { toInputJson } from "@/lib/utils";
import { runExtraction } from "./item-detail-extraction";
import { runIntelligencePipeline } from "./item-detail-extraction";
import { runComparison } from "./item-detail-comparison";
import { recoverStuckItems, handleFinalFailure } from "./item-detail-recovery";
import type { DetailSelectors } from "@/types/portal";
import type { BrowserContext, Page } from "playwright";

const JOB_TIMEOUT_MS = 5 * 60 * 1000;

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

  let successIncremented = false;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

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

    // ── Auth ────────────────────────────────────────────────────
    await emitItemEvent(trackedItemId, "AUTH_START", {
      method: portal.credential?.cookieData ? "cookies" : "credentials",
      baseUrl: portal.baseUrl,
    });

    try {
      ({ context, page } = await resolveAuth({
        credential: portal.credential,
        baseUrl: portal.baseUrl,
        listPageUrl: portal.listPageUrl,
      }));
      await emitItemEvent(trackedItemId, "AUTH_SUCCESS", { landingUrl: page.url() });
    } catch (authErr) {
      await emitFailureEvent(trackedItemId, "AUTH_FAIL", authErr);
      throw authErr;
    }

    try {
      // ── Detail page scrape ──────────────────────────────────
      const detailData = await withEventTracking(
        trackedItemId,
        "DETAIL_SCRAPE_START",
        "DETAIL_SCRAPE_DONE",
        "DETAIL_SCRAPE_FAIL",
        {
          url: item.detailPageUrl,
          selectorCount: Object.keys(detailSelectors.fieldSelectors ?? {}).length,
        },
        () => scrapeDetailPage(page!, item.detailPageUrl!, detailSelectors),
        () => page!.screenshot({ fullPage: true, type: "png" }).then((b) => Buffer.from(b))
      );

      await emitItemEvent(trackedItemId, "SELECTOR_MATCH", {
        fieldCount: Object.keys(detailData).length,
        fields: Object.keys(detailData),
      });

      const existingDetailData = item.detailData as Record<string, string> | null;
      const existingCount = existingDetailData ? Object.keys(existingDetailData).length : 0;
      const newCount = Object.keys(detailData).length;

      const useNewData = newCount === 0
        ? false
        : existingCount === 0 || newCount >= existingCount * 0.5;

      let effectiveDetailData = detailData;

      if (useNewData) {
        await db.trackedItem.update({
          where: { id: trackedItemId },
          data: { detailData: toInputJson(detailData) },
        });
      } else {
        logger.warn(
          { trackedItemId, existingCount, newCount },
          "[worker] Kept existing detailData — new scrape returned significantly fewer fields"
        );
        effectiveDetailData = existingDetailData!;
      }

      // ── Submitted By filter (detail-time) ──────────────────
      const detailFilters = (portal.scrapeFilters ?? {}) as Partial<{ excludeBySubmittedBy: string[] }>;
      const excludeSubmitters = new Set(
        (detailFilters.excludeBySubmittedBy ?? []).map((s) => s.trim().toLowerCase())
      );
      if (excludeSubmitters.size > 0) {
        const submitterVal = (effectiveDetailData["Submitted By"] ?? "").trim().toLowerCase();
        if (submitterVal && excludeSubmitters.has(submitterVal)) {
          logger.info({ trackedItemId, submitterVal }, "[worker] Item excluded by Submitted By filter — deleting");
          await db.trackedItem.delete({ where: { id: trackedItemId } });
          const updatedSession = await db.scrapeSession.update({
            where: { id: item.scrapeSessionId },
            data: { itemsFound: { decrement: 1 } },
          });
          successIncremented = true;
          if (updatedSession.itemsProcessed === updatedSession.itemsFound && updatedSession.itemsFound > 0) {
            runCrossItemChecks(item.scrapeSessionId).catch((err) =>
              logger.error({ err, sessionId: item.scrapeSessionId }, "[worker] Cross-item checks failed")
            );
          }
          return { status: "COMPLETED", mismatchCount: 0 };
        }
      }

      // ── File downloads ──────────────────────────────────────
      const storagePrefix = `portal-files/${portalId}/${trackedItemId}`;
      await emitItemEvent(trackedItemId, "DOWNLOAD_START", { storagePrefix });

      const downloadedFiles = await downloadFiles(page!, detailSelectors, storagePrefix);

      await emitItemEvent(trackedItemId, "DOWNLOAD_DONE", {
        fileCount: downloadedFiles.length,
        files: downloadedFiles.map((f) => ({ name: f.originalName, size: f.sizeBytes })),
      });

      await db.trackedItemFile.deleteMany({ where: { trackedItemId } });
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

      // ── Resolve AI provider ─────────────────────────────────
      const { provider, apiKey, visionModel, textModel, baseURL, displayProvider } = await resolveProviderAndKey(userId);

      let cachedDocTypes: DocTypeRecord[] | undefined;
      try {
        cachedDocTypes = await fetchDocTypes(userId);
      } catch (intErr) {
        logger.warn({ err: intErr }, "[worker] Failed to fetch doc types (non-fatal)");
      }
      const knownDocumentTypes = cachedDocTypes?.map((dt) => dt.name);

      // ── AI extraction ───────────────────────────────────────
      const extraction = await runExtraction({
        trackedItemId,
        downloadedFiles,
        userId,
        provider,
        apiKey,
        visionModel,
        baseURL,
        displayProvider,
        knownDocumentTypes,
        cachedDocTypes,
      });

      // ── Intelligence pipeline ───────────────────────────────
      const acceptableTypeIds = item.scrapeSession.acceptableDocumentTypeIds;
      await runIntelligencePipeline({
        trackedItemId,
        portalId,
        portalItemId: item.portalItemId,
        userId,
        fileExtractions: extraction.fileExtractions,
        tamperingTargets: extraction.tamperingTargets,
        pdfRawFields: extraction.pdfRawFields,
        effectiveDetailData,
        acceptableDocumentTypeIds: acceptableTypeIds,
        cachedDocTypes,
      });

      // ── Template lookup + AI comparison ─────────────────────
      const comparison = await runComparison({
        trackedItemId,
        portalId,
        listData: (item.listData as Record<string, string>) ?? {},
        effectiveDetailData,
        pdfFields: extraction.pdfFields,
        fileExtractions: extraction.fileExtractions,
        provider,
        apiKey,
        textModel,
        baseURL,
        displayProvider,
        comparisonModel: portal.comparisonModel as string | null,
      });

      // ── Final status ────────────────────────────────────────
      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: {
          status: comparison.finalStatus,
          errorMessage: comparison.extractionFailed ? "AI extraction failed for all files" : null,
        },
      });

      await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
        status: comparison.finalStatus,
        mismatchCount: comparison.mismatchCount,
        fileCount: downloadedFiles.length,
        fieldCount: Object.keys(effectiveDetailData).length,
      });

      const updatedSession = await db.scrapeSession.update({
        where: { id: item.scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });
      successIncremented = true;

      if (updatedSession.itemsProcessed === updatedSession.itemsFound && updatedSession.itemsFound > 0) {
        runCrossItemChecks(item.scrapeSessionId).catch((err) =>
          logger.error({ err, sessionId: item.scrapeSessionId }, "[worker] Cross-item checks failed")
        );
      }

      return { status: "COMPLETED", mismatchCount: comparison.mismatchCount };
    } finally {
      await context?.close();
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, trackedItemId }, "[worker] Item detail processing failed");

    let screenshot: Buffer | undefined;
    try {
      if (page && !page.isClosed()) {
        screenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
      }
    } catch {
      // page already closed or crashed
    }

    await emitFailureEvent(trackedItemId, "ITEM_ERROR", err, screenshot);

    await db.trackedItem.update({
      where: { id: trackedItemId },
      data: { status: "ERROR", errorMessage },
    });

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!successIncremented && isFinalAttempt) {
      await db.scrapeSession.updateMany({
        where: { trackedItems: { some: { id: trackedItemId } } },
        data: { itemsProcessed: { increment: 1 } },
      });
    }

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

scheduleStorageCleanup().catch((err) =>
  logger.error({ err }, "[worker] Failed to schedule storage cleanup")
);

const cleanupWorker = startCleanupWorker(runFullCleanup);
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
