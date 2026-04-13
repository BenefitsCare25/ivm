import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeDetailPage, downloadFiles } from "@/lib/playwright/scraper";
import { closeBrowser } from "@/lib/playwright/browser";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { extractFieldsFromDocument } from "@/lib/ai";
import { compareFields } from "@/lib/ai/comparison";
import { findMatchingTemplate, filterFieldsByTemplate } from "@/lib/comparison-templates";
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDuplicate, checkTampering, checkAnomalies, checkPdfMetadata, checkVisualForensics, checkArithmeticConsistency } from "@/lib/intelligence";
import type { DocTypeRecord } from "@/lib/intelligence";
import { emitItemEvent, emitFailureEvent, withEventTracking } from "@/lib/portal-events";
import {
  startItemDetailWorker,
  enqueueItemDetailBatch,
  type ItemDetailJobData,
  type ItemDetailJobResult,
} from "@/lib/queue/item-detail-queue";
import { scheduleStorageCleanup, startCleanupWorker } from "@/lib/queue/cleanup-queue";
import { runStorageCleanup } from "@/lib/storage/cleanup";
import { createHash } from "crypto";
import type { DetailSelectors, TemplateField } from "@/types/portal";
import type { BrowserContext, Page } from "playwright";

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

  // Declare outside try so they're accessible in catch for screenshot capture
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

      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { detailData: JSON.parse(JSON.stringify(detailData)) },
      });

      // ── File downloads ──────────────────────────────────────
      const storagePrefix = `portal-files/${portalId}/${trackedItemId}`;
      await emitItemEvent(trackedItemId, "DOWNLOAD_START", { storagePrefix });

      const downloadedFiles = await downloadFiles(page!, detailSelectors, storagePrefix);

      await emitItemEvent(trackedItemId, "DOWNLOAD_DONE", {
        fileCount: downloadedFiles.length,
        files: downloadedFiles.map((f) => ({ name: f.originalName, size: f.sizeBytes })),
      });

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

      // ── AI extraction from downloaded files ─────────────────
      const { provider, apiKey, visionModel, textModel } = await resolveProviderAndKey(userId);
      const pdfFields: Record<string, string> = {};
      const fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[] = [];

      for (const file of downloadedFiles) {
        if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) {
          try {
            await emitItemEvent(trackedItemId, "AI_EXTRACT_START", {
              fileName: file.originalName,
              provider,
            });
            const t0 = Date.now();

            const { getStorageAdapter } = await import("@/lib/storage");
            const storage = getStorageAdapter();
            const fileBuffer = await storage.download(file.storagePath);

            // Compute file hash for FWA tampering detection
            const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
            await db.trackedItemFile.updateMany({
              where: { trackedItemId, storagePath: file.storagePath },
              data: { fileHash },
            });
            await checkTampering(trackedItemId, portalId, item.portalItemId, file.originalName, fileHash);

            // FWA: PDF metadata forensics (check for Photoshop/GIMP as creator)
            if (file.mimeType === "application/pdf") {
              await checkPdfMetadata(trackedItemId, fileBuffer, file.originalName);
            }

            const extraction = await extractFieldsFromDocument({
              sourceAssetId: trackedItemId,
              mimeType: file.mimeType,
              fileData: fileBuffer,
              fileName: file.originalName,
              provider,
              apiKey,
              model: visionModel,
            });

            for (const field of extraction.fields) {
              pdfFields[field.label] = field.value;
            }

            // FWA: AI visual forensics (pixel-level forgery detection)
            await checkVisualForensics(
              trackedItemId, fileBuffer, file.mimeType, file.originalName,
              provider, apiKey, visionModel
            );

            fileExtractions.push({
              fileName: file.originalName,
              documentType: extraction.documentType,
              fields: extraction.fields.map((f) => ({ label: f.label, value: f.value })),
            });

            await emitItemEvent(
              trackedItemId,
              "AI_EXTRACT_DONE",
              { fileName: file.originalName, fieldCount: extraction.fields.length },
              { durationMs: Date.now() - t0 }
            );
          } catch (err) {
            logger.warn({ err, fileName: file.originalName }, "[worker] Failed to extract from file");
            await emitFailureEvent(trackedItemId, "AI_EXTRACT_FAIL", err);
          }
        }
      }

      // ── Intelligence: classify, validate, deduplicate ──────
      const classifiedDocs: { documentTypeId: string | null; documentTypeName: string | null; fileName: string }[] = [];

      let cachedDocTypes: DocTypeRecord[] | undefined;
      try {
        cachedDocTypes = await fetchDocTypes(userId);
      } catch (intErr) {
        logger.warn({ err: intErr }, "[worker] Failed to fetch doc types (non-fatal)");
      }

      for (const ext of fileExtractions) {
        try {
          const classification = await classifyDocumentType(userId, ext.documentType, cachedDocTypes);
          classifiedDocs.push({
            documentTypeId: classification.documentTypeId,
            documentTypeName: classification.documentTypeName,
            fileName: ext.fileName,
          });

          if (classification.documentTypeId) {
            const matchedDocType = cachedDocTypes?.find((dt) => dt.id === classification.documentTypeId);
            const keyFields = (matchedDocType?.requiredFields as string[]) ?? [];

            await Promise.all([
              validateRequiredFields(
                { name: matchedDocType?.name ?? ext.documentType, requiredFields: matchedDocType?.requiredFields },
                ext.fields,
                { trackedItemId }
              ),
              checkDuplicate(userId, classification.documentTypeId, keyFields, ext.fields, {
                trackedItemId,
              }),
            ]);
          }
        } catch (intErr) {
          logger.warn({ err: intErr, fileName: ext.fileName }, "[worker] Intelligence pipeline error (non-fatal)");
        }
      }

      // ── FWA: anomaly detection on scraped portal data ──────
      try {
        const allDataForAnomaly: Record<string, string> = {
          ...(item.listData as Record<string, string>),
          ...detailData,
        };
        await checkAnomalies(trackedItemId, portalId, allDataForAnomaly);
      } catch (err) {
        logger.warn({ err }, "[worker] Anomaly check error (non-fatal)");
      }

      // ── FWA: arithmetic consistency on extracted PDF fields ──
      if (Object.keys(pdfFields).length > 0) {
        try {
          await checkArithmeticConsistency(trackedItemId, pdfFields);
        } catch (err) {
          logger.warn({ err }, "[worker] Arithmetic check error (non-fatal)");
        }
      }

      // ── Template lookup + AI field comparison ──────────────
      let comparisonResult;
      let templateId: string | null = null;

      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        const allPageData = {
          ...(item.listData as Record<string, string>),
          ...detailData,
        };
        const template = await findMatchingTemplate(portalId, allPageData);

        let comparePageFields = detailData;
        let comparePdfFields = pdfFields;
        let templateFields: TemplateField[] | undefined;

        if (template) {
          templateId = template.id;
          templateFields = template.fields;
          const filtered = filterFieldsByTemplate(detailData, pdfFields, template.fields);
          comparePageFields = filtered.filteredPageFields;
          comparePdfFields = filtered.filteredPdfFields;

          logger.info(
            { templateId, templateName: template.name, fieldCount: template.fields.length },
            "[worker] Using comparison template"
          );
        } else {
          logger.info("[worker] No matching template, using full comparison");
        }

        if (Object.keys(comparePageFields).length > 0 || Object.keys(comparePdfFields).length > 0) {
          comparisonResult = await withEventTracking(
            trackedItemId,
            "AI_COMPARE_START",
            "AI_COMPARE_DONE",
            "AI_COMPARE_FAIL",
            {
              provider,
              pageFieldCount: Object.keys(comparePageFields).length,
              pdfFieldCount: Object.keys(comparePdfFields).length,
              templateId: templateId ?? undefined,
            },
            () => compareFields({
              pageFields: comparePageFields,
              pdfFields: comparePdfFields,
              provider,
              apiKey,
              model: textModel,
              templateFields,
            })
          );
        }
      }

      if (comparisonResult) {
        await db.comparisonResult.create({
          data: {
            trackedItemId,
            provider,
            templateId,
            fieldComparisons: JSON.parse(JSON.stringify(comparisonResult.fieldComparisons)),
            matchCount: comparisonResult.matchCount,
            mismatchCount: comparisonResult.mismatchCount,
            summary: comparisonResult.summary,
            completedAt: new Date(),
          },
        });
      }

      const noDocuments = downloadedFiles.length === 0;
      const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
      const finalStatus = noDocuments ? "REQUIRE_DOC" : hasMismatch ? "FLAGGED" : "COMPARED";

      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { status: finalStatus },
      });

      await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
        status: finalStatus,
        mismatchCount: comparisonResult?.mismatchCount ?? 0,
        fileCount: downloadedFiles.length,
        fieldCount: Object.keys(detailData).length,
      });

      await db.scrapeSession.update({
        where: { id: item.scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });

      return { status: "COMPLETED", mismatchCount: comparisonResult?.mismatchCount ?? 0 };
    } finally {
      await context?.close();
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, trackedItemId }, "[worker] Item detail processing failed");

    // Capture screenshot of current page state if browser is still open
    let screenshot: Buffer | undefined;
    try {
      if (page && !page.isClosed()) {
        screenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
      }
    } catch {
      // page already closed or crashed — ignore
    }

    await emitFailureEvent(trackedItemId, "ITEM_ERROR", err, screenshot);

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
