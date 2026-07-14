import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth, isLoginPage } from "@/lib/playwright/auth";
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
import { runFullCleanup } from "@/lib/storage/cleanup";
import { snapshotPortalDayAsync } from "@/lib/portal-metrics";
import { toInputJson } from "@/lib/utils";
import { runExtraction } from "./item-detail-extraction";
import { runIntelligencePipeline } from "./item-detail-extraction";
import { runComparison, shouldPreservePriorComparison } from "./item-detail-comparison";
import { recoverStuckItems, handleFinalFailure } from "./item-detail-recovery";
import type { DetailSelectors } from "@/types/portal";
import type { BrowserContext, Page } from "playwright";

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

const AUTH_ERROR_SIGNATURES = [
  "Portal session expired",
  "session expired",
  "No authentication method",
  "Cookie auth landed on login page",
  "Failed to decrypt credentials",
] as const;

function isAuthError(message: string): boolean {
  return AUTH_ERROR_SIGNATURES.some((sig) => message.includes(sig));
}

async function finalizeIfComplete(
  session: { id: string; itemsProcessed: number; itemsFound: number; portalId: string; createdAt: Date },
  trigger: string,
): Promise<void> {
  if (session.itemsProcessed === session.itemsFound && session.itemsFound > 0) {
    await db.scrapeSession.update({ where: { id: session.id }, data: { completedAt: new Date() } });
    snapshotPortalDayAsync(session.portalId, session.createdAt, trigger);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => Promise<void>
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(async () => {
      try {
        if (onTimeout) await onTimeout();
      } catch {
        // best-effort — don't let cleanup errors mask the timeout
      }
      reject(new Error(`Timed out after ${ms / 1000}s: ${label}`));
    }, ms);
  });

  return Promise.race([
    promise.finally(() => { if (timeoutHandle !== undefined) clearTimeout(timeoutHandle); }),
    timeoutPromise,
  ]);
}

async function processItemDetailCore(
  job: Job<ItemDetailJobData>
): Promise<ItemDetailJobResult> {
  const { trackedItemId, portalId, userId } = job.data;

  // Remember the status BEFORE we flip to PROCESSING: if a prior run already
  // produced a terminal result, a failed re-run must not clobber it to ERROR.
  const priorItem = await db.trackedItem.findUnique({
    where: { id: trackedItemId },
    select: { status: true },
  });
  const priorStatus = priorItem?.status;

  await db.trackedItem.update({
    where: { id: trackedItemId },
    data: { status: "PROCESSING", processingStartedAt: new Date() },
  });

  let successIncremented = false;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let scrapeSessionId: string | undefined;
  // A known portal URL used by the error path to reliably re-probe for an
  // auth-expiry (login) redirect after a navigation failure.
  let authCheckUrl: string | undefined;

  try {
    const item = await db.trackedItem.findUniqueOrThrow({
      where: { id: trackedItemId },
      include: {
        scrapeSession: {
          include: { portal: { include: { credential: true } } },
        },
      },
    });

    scrapeSessionId = item.scrapeSessionId;
    const portal = item.scrapeSession.portal;
    authCheckUrl = portal.listPageUrl ?? portal.baseUrl;
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

      // Detect mid-session auth expiration: 0 fields + page looks like login
      if (Object.keys(detailData).length === 0 && page && !page.isClosed()) {
        const loginDetected = await isLoginPage(page);
        if (loginDetected) {
          const msg = "Portal session expired — page redirected to login. Update cookies on the portal page and retry.";
          logger.warn({ trackedItemId, url: page.url() }, "[worker] " + msg);
          await emitFailureEvent(trackedItemId, "AUTH_FAIL", new Error(msg));
          throw new Error(msg);
        }
      }

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
        effectiveDetailData = existingDetailData ?? {};
      }

      // ── Submitted By filter (detail-time) ──────────────────
      const detailFilters = (portal.scrapeFilters ?? {}) as Partial<{ excludeBySubmittedBy: string[] }>;
      const excludeSubmitters = new Set(
        (detailFilters.excludeBySubmittedBy ?? []).map((s) => s.trim().toLowerCase())
      );
      if (excludeSubmitters.size > 0) {
        const submitterVal = (effectiveDetailData["Submitted By"] ?? "").trim().toLowerCase();
        if (submitterVal && excludeSubmitters.has(submitterVal)) {
          logger.info({ trackedItemId, submitterVal }, "[worker] Item excluded by Submitted By filter — marking FILTERED");
          // Retain the item (do NOT delete) so the session still shows it was
          // found and why it was set aside. Keep itemsFound intact and count it
          // toward itemsProcessed so completion math stays correct.
          await db.trackedItem.update({
            where: { id: trackedItemId },
            data: {
              status: "FILTERED",
              errorMessage: `Excluded by "Submitted By" filter (submitted by ${submitterVal})`,
            },
          });
          await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
            status: "FILTERED",
            reason: "submitted_by_filter",
            submittedBy: submitterVal,
          });
          const updatedSession = await db.scrapeSession.update({
            where: { id: item.scrapeSessionId },
            data: { itemsProcessed: { increment: 1 } },
          });
          successIncremented = true;
          await finalizeIfComplete(updatedSession, "filter-skip");
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

      // If this run degraded (some/all documents failed to extract) and a richer
      // prior comparison exists, preserve ALL prior state — skip both the
      // destructive intelligence rewrite below and the comparison overwrite — so
      // a failed re-read never corrupts a previously-good result.
      const preservePrior =
        extraction.failedFiles.length > 0 &&
        (await shouldPreservePriorComparison(trackedItemId, extraction.fileExtractions.length));

      // ── Intelligence pipeline ───────────────────────────────
      const acceptableTypeIds = item.scrapeSession.acceptableDocumentTypeIds;
      if (!preservePrior) {
        await runIntelligencePipeline({
          trackedItemId,
          portalId,
          portalItemId: item.portalItemId,
          userId,
          fileExtractions: extraction.fileExtractions,
          tamperingTargets: extraction.tamperingTargets,
          pdfRawFields: extraction.pdfRawFields,
          effectiveDetailData,
          listData: (item.listData as Record<string, string>) ?? {},
          acceptableDocumentTypeIds: acceptableTypeIds,
          cachedDocTypes,
        });
      }

      // ── Template lookup + AI comparison ─────────────────────
      const comparison = await runComparison({
        trackedItemId,
        portalId,
        listData: (item.listData as Record<string, string>) ?? {},
        effectiveDetailData,
        pdfFields: extraction.pdfFields,
        pdfFieldSources: extraction.pdfFieldSources,
        fileExtractions: extraction.fileExtractions,
        downloadedFiles: downloadedFiles.map((f) => ({
          originalName: f.originalName,
          storagePath: f.storagePath,
          mimeType: f.mimeType,
        })),
        failedFiles: extraction.failedFiles,
        preservePrior,
        fileBuffers: extraction.fileBuffers,
        provider,
        apiKey,
        textModel,
        visionModel,
        baseURL,
        displayProvider,
        comparisonModel: portal.comparisonModel as string | null,
        cachedDocTypes,
      });

      // ── Final status ────────────────────────────────────────
      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: {
          status: comparison.finalStatus,
          errorMessage: comparison.reviewMessage,
        },
      });

      await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
        status: comparison.finalStatus,
        mismatchCount: comparison.mismatchCount,
        fileCount: downloadedFiles.length,
        fieldCount: Object.keys(effectiveDetailData).length,
      });

      const completedSession = await db.scrapeSession.update({
        where: { id: item.scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });
      successIncremented = true;
      await finalizeIfComplete(completedSession, "item-complete");

      return { status: "COMPLETED", mismatchCount: comparison.mismatchCount };
    } finally {
      await context?.close();
    }
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, trackedItemId }, "[worker] Item detail processing failed");

    // Reliable auth-expiry probe. After a navigation failure the page often still
    // shows the last good page — an aborted goto doesn't reliably land on the login
    // redirect — so checking the current page alone misses real expiries. Instead
    // actively re-navigate to a known portal URL and check for a login redirect; if
    // found, reclassify as auth expiry so the circuit breaker + authExpiredAt fire
    // and the user gets an actionable "session expired" banner. Scoped to navigation
    // errors so ordinary AI/timeout failures don't pay for the extra navigation.
    let reclassified = false;
    if (page && !page.isClosed() && authCheckUrl && /ERR_ABORTED|net::ERR|page\.goto/i.test(errorMessage)) {
      try {
        await page.goto(authCheckUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        if (await isLoginPage(page)) {
          errorMessage = "Portal session expired — the portal redirected to login. Update cookies on the portal page and retry.";
          reclassified = true;
        }
      } catch {
        // best-effort probe — never mask the original failure
      }
    }

    let screenshot: Buffer | undefined;
    try {
      if (page && !page.isClosed()) {
        screenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
      }
    } catch {
      // page already closed or crashed
    }

    // Preserve the original error's stack for diagnosis; only substitute a synthetic
    // error when we deliberately rewrote the message (auth reclassification).
    await emitFailureEvent(trackedItemId, "ITEM_ERROR", reclassified ? new Error(errorMessage) : err, screenshot);

    // Check current status before updating — on timeout, handleFinalFailure
    // already set ERROR and incremented itemsProcessed.
    const currentItem = await db.trackedItem.findUnique({
      where: { id: trackedItemId },
      select: { status: true },
    });
    const alreadyHandled = currentItem?.status === "ERROR";

    // Never overwrite a good comparison with ERROR (the contradictory
    // "Error + full comparison" state). Two cases:
    //  1. currentIsSuccess — the success path already set a terminal status THIS run,
    //     then a later step threw. Leave the status; the final-attempt block below
    //     still handles the itemsProcessed count via `successIncremented`.
    //  2. restoredPrior — a failed RE-RUN of an item a prior run had completed
    //     (currentItem is PROCESSING now, but priorStatus + a saved ComparisonResult
    //     prove a good result exists). Restore it; it was already counted.
    const SUCCESS_STATUSES = ["FLAGGED", "COMPARED", "VERIFIED", "REQUIRE_DOC"];
    const currentIsSuccess = !!currentItem && SUCCESS_STATUSES.includes(currentItem.status);
    let restoredPrior = false;
    if (!alreadyHandled && !currentIsSuccess && !!priorStatus && SUCCESS_STATUSES.includes(priorStatus)) {
      const hasComparison = await db.comparisonResult.findUnique({
        where: { trackedItemId },
        select: { trackedItemId: true },
      });
      if (hasComparison) {
        await db.trackedItem.update({
          where: { id: trackedItemId },
          data: {
            status: priorStatus,
            errorMessage: `Re-run failed (${errorMessage.split("\n")[0].slice(0, 140)}) — showing the previous result.`,
          },
        });
        restoredPrior = true;
        successIncremented = true; // already counted on the prior completion — don't double-count
      }
    }

    // Only write ERROR when there is no good result to preserve.
    if (!alreadyHandled && !restoredPrior && !currentIsSuccess) {
      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: { status: "ERROR", errorMessage },
      });
    }

    if (scrapeSessionId && isAuthError(errorMessage)) {
      const { count: cancelled } = await db.trackedItem.updateMany({
        where: { scrapeSessionId, status: "DISCOVERED" },
        data: { status: "ERROR", errorMessage: "Skipped — portal authentication expired. Update cookies and retry." },
      });
      if (cancelled > 0) {
        logger.warn({ sessionId: scrapeSessionId, cancelled }, "[worker] Auth failure circuit breaker — cancelled remaining DISCOVERED items");
        await db.scrapeSession.update({
          where: { id: scrapeSessionId },
          data: {
            itemsProcessed: { increment: cancelled },
            authExpiredAt: new Date(),
          },
        });
      } else {
        await db.scrapeSession.update({
          where: { id: scrapeSessionId },
          data: { authExpiredAt: new Date() },
        });
      }
    }

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!alreadyHandled && !successIncremented && isFinalAttempt && scrapeSessionId) {
      const updated = await db.scrapeSession.update({
        where: { id: scrapeSessionId },
        data: { itemsProcessed: { increment: 1 } },
      });
      await finalizeIfComplete(updated, "error-path");
    }

    return { status: "FAILED", mismatchCount: 0, errorMessage };
  }
}

async function processItemDetail(
  job: Job<ItemDetailJobData>
): Promise<ItemDetailJobResult> {
  const timeoutMinutes = Math.round(JOB_TIMEOUT_MS / 60_000);
  return withTimeout(
    processItemDetailCore(job),
    JOB_TIMEOUT_MS,
    `item:${job.data.trackedItemId}`,
    () => handleFinalFailure(
      job,
      new Error(`Processing timed out after ${timeoutMinutes} minutes — too many documents or AI took too long`)
    )
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
