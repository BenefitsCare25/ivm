import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeDetailPage, downloadFiles } from "@/lib/playwright/scraper";
import { closeBrowser } from "@/lib/playwright/browser";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { extractFieldsFromDocument } from "@/lib/ai";
import { compareFields } from "@/lib/ai/comparison";
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import { findMatchingTemplate, filterFieldsByTemplate, filterComparisonsByTemplate } from "@/lib/comparison-templates";
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDocTypeMatch, checkDuplicate, checkTampering } from "@/lib/intelligence";
import type { DocTypeRecord } from "@/lib/intelligence";
import { emitItemEvent, emitFailureEvent, withEventTracking } from "@/lib/portal-events";
import {
  startItemDetailWorker,
  enqueueItemDetailBatch,
  getItemDetailQueue,
  type ItemDetailJobData,
  type ItemDetailJobResult,
} from "@/lib/queue/item-detail-queue";
import { scheduleStorageCleanup, startCleanupWorker } from "@/lib/queue/cleanup-queue";
import { runCrossItemChecks } from "@/lib/validations/cross-item";
import { checkForeignCurrency } from "@/lib/validations/currency";
import { runFullCleanup } from "@/lib/storage/cleanup";
import { toInputJson } from "@/lib/utils";
import { createHash } from "crypto";
import type { MatchedTemplate } from "@/lib/comparison-templates";
import type { DetailSelectors, TemplateField, BusinessRule, RequiredDocument, BusinessRuleResult, RequiredDocumentCheck } from "@/types/portal";
import type { BrowserContext, Page } from "playwright";

// Hard cap per job — prevents hung Playwright or AI calls from blocking a slot indefinitely
const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

      // Preserve existing detailData if the new scrape returned fewer fields
      // (protects against retries picking up garbage from non-claim page sections)
      const existingDetailData = item.detailData as Record<string, string> | null;
      const existingCount = existingDetailData ? Object.keys(existingDetailData).length : 0;
      const newCount = Object.keys(detailData).length;

      const useNewData = newCount === 0
        ? false  // empty scrape — keep whatever we had
        : existingCount === 0 || newCount >= existingCount * 0.5;

      // effectiveDetailData is what we use for downstream comparison
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
      // "Submitted By" isn't on the list page so it must be checked here
      const detailFilters = (portal.scrapeFilters ?? {}) as Partial<{ excludeBySubmittedBy: string[] }>;
      const excludeSubmitters = new Set(
        (detailFilters.excludeBySubmittedBy ?? []).map((s) => s.trim().toLowerCase())
      );
      if (excludeSubmitters.size > 0) {
        const submitterVal = (effectiveDetailData["Submitted By"] ?? "").trim().toLowerCase();
        if (submitterVal && excludeSubmitters.has(submitterVal)) {
          logger.info({ trackedItemId, submitterVal }, "[worker] Item excluded by Submitted By filter — deleting");
          // Delete the item so it never appears in the session table.
          // Decrement itemsFound so session completion arithmetic stays correct.
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

      // ── AI extraction from downloaded files ─────────────────
      const { provider, apiKey, visionModel, textModel, baseURL, displayProvider } = await resolveProviderAndKey(userId);
      const pdfFields: Record<string, string> = {};
      const pdfRawFields: Record<string, string> = {};
      const fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[] = [];
      const tamperingTargets: { fileName: string; fileHash: string }[] = [];

      // Fetch doc types before extraction so the AI receives the constrained list,
      // eliminating fuzzy-match ambiguity during classification.
      let cachedDocTypes: DocTypeRecord[] | undefined;
      let docTypeById: Map<string, DocTypeRecord> | undefined;
      try {
        cachedDocTypes = await fetchDocTypes(userId);
        docTypeById = new Map(cachedDocTypes.map((dt) => [dt.id, dt]));
      } catch (intErr) {
        logger.warn({ err: intErr }, "[worker] Failed to fetch doc types (non-fatal)");
      }
      const knownDocumentTypes = cachedDocTypes?.map((dt) => dt.name);

      for (const file of downloadedFiles) {
        if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) {
          try {
            await emitItemEvent(trackedItemId, "AI_EXTRACT_START", {
              fileName: file.originalName,
              provider: displayProvider,
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
            // Only PDF files are hash-stable across downloads — images (JPEG/PNG) are
            // often re-encoded server-side on each request, causing hash false positives.
            // Deduplicate by fileName so multiple files sharing the same originalName
            // don't produce duplicate tampering alerts.
            if (
              file.mimeType === "application/pdf" &&
              !tamperingTargets.some((t) => t.fileName === file.originalName)
            ) {
              tamperingTargets.push({ fileName: file.originalName, fileHash });
            }

            const extraction = await extractFieldsFromDocument({
              sourceAssetId: trackedItemId,
              mimeType: file.mimeType,
              fileData: fileBuffer,
              fileName: file.originalName,
              provider,
              apiKey,
              model: visionModel,
              baseURL,
              storagePath: file.storagePath,
              knownDocumentTypes,
            });

            for (const field of extraction.fields) {
              pdfFields[field.label] = field.value;
              pdfRawFields[field.label] = field.rawText ?? field.value;
            }

            fileExtractions.push({
              fileName: file.originalName,
              documentType: extraction.documentType,
              fields: extraction.fields.map((f) => ({ label: f.label, value: f.value })),
            });

            if (extraction.truncated) {
              await emitItemEvent(trackedItemId, "AI_EXTRACT_TRUNCATED", {
                fileName: file.originalName,
                note: "Response hit max_tokens limit — partial extraction",
              });
            }

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
      // Clear intelligence ValidationResults from previous attempts before re-running
      await db.validationResult.deleteMany({
        where: {
          trackedItemId,
          ruleType: { in: ["DUPLICATE", "TAMPERING", "REQUIRED_FIELD", "DOC_TYPE_MATCH"] },
        },
      });

      // Run tampering checks after the delete so results are not immediately wiped
      const tamperingResults = await Promise.allSettled(
        tamperingTargets.map(({ fileName, fileHash }) =>
          checkTampering(trackedItemId, portalId, item.portalItemId, fileName, fileHash)
        )
      );
      for (const r of tamperingResults) {
        if (r.status === "rejected") logger.warn({ err: r.reason, trackedItemId }, "[worker] Tampering check failed (non-fatal)");
      }

      const classifiedDocs: { documentTypeId: string | null; documentTypeName: string | null; fileName: string }[] = [];

      for (const ext of fileExtractions) {
        try {
          const classification = await classifyDocumentType(userId, ext.documentType, cachedDocTypes);
          classifiedDocs.push({
            documentTypeId: classification.documentTypeId,
            documentTypeName: classification.documentTypeName,
            fileName: ext.fileName,
          });

          if (classification.documentTypeId) {
            const matchedDocType = docTypeById?.get(classification.documentTypeId);
            const keyFields = (matchedDocType?.requiredFields as string[]) ?? [];

            const intelligenceResults = await Promise.allSettled([
              validateRequiredFields(
                { name: matchedDocType?.name ?? ext.documentType, requiredFields: matchedDocType?.requiredFields },
                ext.fields,
                { trackedItemId }
              ),
              checkDuplicate(userId, classification.documentTypeId, keyFields, ext.fields, {
                trackedItemId,
              }),
            ]);
            for (const r of intelligenceResults) {
              if (r.status === "rejected") logger.warn({ err: r.reason, trackedItemId }, "[worker] Intelligence check failed (non-fatal)");
            }
          }
        } catch (intErr) {
          logger.warn({ err: intErr, fileName: ext.fileName }, "[worker] Intelligence pipeline error (non-fatal)");
        }
      }

      // Doc type mismatch — once per item using the first classified file
      const acceptableTypeIds = item.scrapeSession.acceptableDocumentTypeIds;
      if (acceptableTypeIds.length > 0) {
        const acceptableTypeNames = acceptableTypeIds
          .map((tid) => docTypeById?.get(tid)?.name ?? "Unknown");
        const primary = classifiedDocs[0];
        try {
          await checkDocTypeMatch(
            primary?.documentTypeId ?? null,
            primary?.documentTypeName ?? null,
            acceptableTypeIds,
            acceptableTypeNames,
            { trackedItemId }
          );
        } catch (intErr) {
          logger.warn({ err: intErr }, "[worker] Doc type match check error (non-fatal)");
        }
      }

      // ── Foreign currency detection + SGD conversion ────────
      if (Object.keys(pdfRawFields).length > 0) {
        checkForeignCurrency(trackedItemId, pdfRawFields, effectiveDetailData).catch((err) =>
          logger.warn({ err, trackedItemId }, "[worker] Currency check failed (non-fatal)")
        );
      }

      // ── Template lookup + AI field comparison ──────────────
      let comparisonResult;
      let templateId: string | null = null;
      let matchedTemplate: MatchedTemplate | null = null;

      if (Object.keys(effectiveDetailData).length > 0 && Object.keys(pdfFields).length > 0) {
        const allPageData = {
          ...(item.listData as Record<string, string>),
          ...effectiveDetailData,
        };
        const template = await findMatchingTemplate(portalId, allPageData);
        matchedTemplate = template;

        let comparePageFields = effectiveDetailData;
        let comparePdfFields = pdfFields;
        let templateFields: TemplateField[] | undefined;

        const documentTypesFound = fileExtractions.map((e) => e.documentType);

        if (template) {
          templateId = template.id;
          templateFields = template.fields;
          const filtered = filterFieldsByTemplate(effectiveDetailData, pdfFields, template.fields);
          comparePageFields = filtered.filteredPageFields;
          comparePdfFields = filtered.filteredPdfFields;

          logger.info(
            { templateId, templateName: template.name, fieldCount: template.fields.length,
              businessRuleCount: template.businessRules.length, requiredDocCount: template.requiredDocuments.length },
            "[worker] Using comparison template"
          );
        } else {
          logger.info("[worker] No matching template, using full comparison");
        }

        if (Object.keys(comparePageFields).length > 0 || Object.keys(comparePdfFields).length > 0) {
          // Determine if we need the full combined prompt (has business rules or required docs)
          const useFullPrompt = template &&
            (template.businessRules.length > 0 || template.requiredDocuments.length > 0);

          const systemPromptOverride = useFullPrompt ? getFullComparisonSystemPrompt() : undefined;
          const userPromptOverride = useFullPrompt && template ? buildFullComparisonUserPrompt({
            fields: template.fields,
            businessRules: template.businessRules,
            requiredDocuments: template.requiredDocuments,
            pageFields: comparePageFields,
            pdfFields: comparePdfFields,
            documentTypesFound,
          }) : undefined;

          comparisonResult = await withEventTracking(
            trackedItemId,
            "AI_COMPARE_START",
            "AI_COMPARE_DONE",
            "AI_COMPARE_FAIL",
            {
              provider: displayProvider,
              pageFieldCount: Object.keys(comparePageFields).length,
              pdfFieldCount: Object.keys(comparePdfFields).length,
              templateId: templateId ?? undefined,
              useFullPrompt: !!useFullPrompt,
            },
            () => compareFields({
              pageFields: comparePageFields,
              pdfFields: comparePdfFields,
              provider,
              apiKey,
              model: (portal.comparisonModel as string | null) ?? textModel,
              baseURL,
              templateFields,
              systemPromptOverride,
              userPromptOverride,
            })
          );
        }
      }

      if (comparisonResult) {
        // Filter out extra field comparisons the AI added beyond the template config
        if (matchedTemplate && matchedTemplate.fields.length > 0) {
          comparisonResult.fieldComparisons = filterComparisonsByTemplate(
            comparisonResult.fieldComparisons,
            matchedTemplate.fields
          );
          comparisonResult.matchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MATCH").length;
          comparisonResult.mismatchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
        }

        const comparisonsJson = toInputJson(comparisonResult.fieldComparisons);
        const diagnosisJson = comparisonResult.diagnosisAssessment
          ? toInputJson(comparisonResult.diagnosisAssessment)
          : null;

        const comparisonData = {
          provider: displayProvider,
          templateId,
          fieldComparisons: comparisonsJson,
          matchCount: comparisonResult.matchCount,
          mismatchCount: comparisonResult.mismatchCount,
          summary: comparisonResult.summary,
          diagnosisAssessment: diagnosisJson,
          completedAt: new Date(),
        };
        await db.comparisonResult.upsert({
          where: { trackedItemId },
          create: { trackedItemId, ...comparisonData },
          update: comparisonData,
        });

        // Clean up old validation results from previous attempts before re-inserting
        await db.validationResult.deleteMany({
          where: { trackedItemId, ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT"] } },
        });

        // Save business rule results as ValidationResult records
        if (comparisonResult.businessRuleResults && matchedTemplate) {
          const brByRule = new Map(matchedTemplate.businessRules.map((br: BusinessRule) => [br.rule, br]));
          const brInserts = comparisonResult.businessRuleResults
            .filter((r: BusinessRuleResult) => r.status === "FAIL" || r.status === "WARNING")
            .map((r: BusinessRuleResult) => {
              const matchedRule = brByRule.get(r.rule);
              const status = r.status === "FAIL" ? "FAIL" : "WARNING";
              return db.validationResult.create({
                data: {
                  trackedItemId,
                  ruleType: "BUSINESS_RULE",
                  status,
                  message: `${r.category}: ${r.rule}`,
                  metadata: toInputJson({
                    rule: r.rule,
                    category: r.category,
                    severity: matchedRule?.severity ?? "warning",
                    evidence: r.evidence,
                    notes: r.notes,
                    aiStatus: r.status,
                  }),
                },
              });
            });
          if (brInserts.length > 0) await Promise.all(brInserts);
        }

        // Save required document failures as ValidationResult records
        if (comparisonResult.requiredDocumentsCheck && matchedTemplate) {
          const rdByName = new Map(matchedTemplate.requiredDocuments.map((rd: RequiredDocument) => [rd.documentTypeName, rd]));
          const rdInserts = comparisonResult.requiredDocumentsCheck
            .filter((d: RequiredDocumentCheck) => !d.found)
            .map((d: RequiredDocumentCheck) => {
              const matchedReqDoc = rdByName.get(d.documentTypeName);
              return db.validationResult.create({
                data: {
                  trackedItemId,
                  ruleType: "REQUIRED_DOCUMENT",
                  status: "FAIL",
                  message: `Required document not found: ${d.documentTypeName}`,
                  metadata: toInputJson({
                    documentTypeName: d.documentTypeName,
                    group: matchedReqDoc?.group ?? null,
                    notes: d.notes,
                  }),
                },
              });
            });
          if (rdInserts.length > 0) await Promise.all(rdInserts);
        }
      }

      const noDocuments = downloadedFiles.length === 0;
      const extractionFailed = downloadedFiles.length > 0 && Object.keys(pdfFields).length === 0;
      const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
      const hasRuleFailure = comparisonResult?.businessRuleResults?.some(
        (r: BusinessRuleResult) => r.status === "FAIL"
      ) ?? false;
      const hasMissingDoc = comparisonResult?.requiredDocumentsCheck?.some(
        (d: RequiredDocumentCheck) => !d.found
      ) ?? false;
      const finalStatus = noDocuments
        ? "REQUIRE_DOC"
        : extractionFailed
          ? "ERROR"
          : (hasMismatch || hasRuleFailure || hasMissingDoc) ? "FLAGGED" : "COMPARED";

      await db.trackedItem.update({
        where: { id: trackedItemId },
        data: {
          status: finalStatus,
          errorMessage: extractionFailed ? "AI extraction failed for all files" : null,
        },
      });

      await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
        status: finalStatus,
        mismatchCount: comparisonResult?.mismatchCount ?? 0,
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

  const erroredItemIds = await db.trackedItemEvent.findMany({
    where: {
      trackedItemId: { in: stuck.map((s) => s.id) },
      eventType: "ITEM_ERROR",
    },
    select: { trackedItemId: true },
  }).then((events) => new Set(events.map((e) => e.trackedItemId)));

  const toRetry = stuck.filter((s) => !erroredItemIds.has(s.id));
  const toError = stuck.filter((s) => erroredItemIds.has(s.id));

  if (toError.length > 0) {
    logger.warn({ count: toError.length, ids: toError.map((s) => s.id) },
      "[worker] Setting previously-errored PROCESSING items to ERROR");
    await db.trackedItem.updateMany({
      where: { id: { in: toError.map((s) => s.id) } },
      data: { status: "ERROR", errorMessage: "Worker restarted after error" },
    });
  }

  if (toRetry.length > 0) {
    logger.warn({ count: toRetry.length }, "[worker] Re-enqueuing genuinely stuck items");
    await db.trackedItem.updateMany({
      where: { id: { in: toRetry.map((s) => s.id) } },
      data: { status: "DISCOVERED", errorMessage: null },
    });
    await enqueueItemDetailBatch(
      toRetry.map((item) => ({
        trackedItemId: item.id,
        portalId: item.scrapeSession.portalId,
        userId: item.scrapeSession.portal.userId,
      })),
      { reprocess: true }
    );
  }

  // Also recover DISCOVERED items whose BullMQ jobs were lost (e.g. after
  // repeated worker crashes exhaust the retry limit and orphan Redis jobs).
  await recoverOrphanedDiscoveredItems();
}

async function recoverOrphanedDiscoveredItems(): Promise<void> {
  const queue = getItemDetailQueue();
  if (!queue) return;

  const discovered = await db.trackedItem.findMany({
    where: { status: "DISCOVERED" },
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

  if (discovered.length === 0) return;

  // Check which of these items have NO live BullMQ job (waiting/active/delayed).
  // If the job is missing or in a terminal state, we need to re-enqueue it.
  const orphaned = (
    await Promise.all(
      discovered.map(async (item) => {
        const job = await queue.getJob(`item_${item.id}`);
        if (!job) return item;
        const state = await job.getState();
        return state === "completed" || state === "failed" || state === "unknown" ? item : null;
      })
    )
  ).filter(Boolean) as typeof discovered;

  if (orphaned.length === 0) return;

  logger.warn({ count: orphaned.length }, "[worker] Re-enqueuing orphaned DISCOVERED items with no BullMQ job");
  await enqueueItemDetailBatch(
    orphaned.map((item) => ({
      trackedItemId: item.id,
      portalId: item.scrapeSession.portalId,
      userId: item.scrapeSession.portal.userId,
    })),
    { reprocess: true }
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
