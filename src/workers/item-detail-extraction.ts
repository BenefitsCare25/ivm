import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { extractFieldsFromDocument } from "@/lib/ai";
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDocTypeMatch, checkTampering } from "@/lib/intelligence";
import type { DocTypeRecord } from "@/lib/intelligence";
import { emitItemEvent, emitFailureEvent } from "@/lib/portal-events";
import { checkForeignCurrency } from "@/lib/validations/currency";
import type { AIProvider } from "@/lib/ai/types";
import type { DownloadedFile } from "@/lib/playwright/scraper";
import { toInputJson } from "@/lib/utils";
import { createHash } from "crypto";

export interface ExtractionResult {
  pdfFields: Record<string, string>;
  pdfRawFields: Record<string, string>;
  pdfFieldSources: Record<string, string>;
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[];
  tamperingTargets: { fileName: string; fileHash: string }[];
  /** Buffers downloaded during extraction, keyed by storagePath — reused for vision re-checks. */
  fileBuffers: Map<string, Buffer>;
  /** Supported files whose extraction failed (present but unreadable) — distinct from absent documents. */
  failedFiles: string[];
  cachedDocTypes?: DocTypeRecord[];
}

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runnerCount = Math.min(Math.max(1, limit), items.length || 1);
  const runners = Array.from({ length: runnerCount }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

type PerFileResult =
  | {
      ok: true;
      fileName: string;
      mimeType: string;
      storagePath: string;
      buffer: Buffer;
      fileHash: string;
      documentType: string;
      fields: { label: string; value: string; rawText?: string }[];
    }
  | { ok: false; fileName: string; mimeType?: string; fileHash?: string };

export async function runExtraction({
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
}: {
  trackedItemId: string;
  downloadedFiles: DownloadedFile[];
  userId: string;
  provider: AIProvider;
  apiKey: string;
  visionModel: string;
  baseURL?: string;
  displayProvider: string;
  knownDocumentTypes?: string[];
  cachedDocTypes?: DocTypeRecord[];
}): Promise<ExtractionResult> {
  const supportedFiles = downloadedFiles.filter(
    (f) => f.mimeType === "application/pdf" || f.mimeType.startsWith("image/")
  );

  // Extract each attachment (bounded concurrency — default 1/serial; raise via
  // ATTACHMENT_CONCURRENCY on a smaller/faster model). Per-file failures are
  // captured, never thrown, so one unreadable file doesn't sink the others.
  const perFile = await mapWithConcurrency(
    supportedFiles,
    env.ATTACHMENT_CONCURRENCY,
    async (file): Promise<PerFileResult> => {
      // Declared outside the try so a hash computed before an extraction failure
      // still flows to the tampering check (fraud coverage for unreadable files).
      let fileHash: string | undefined;
      try {
        await emitItemEvent(trackedItemId, "AI_EXTRACT_START", {
          fileName: file.originalName,
          provider: displayProvider,
        });
        const t0 = Date.now();

        const { getStorageAdapter } = await import("@/lib/storage");
        const storage = getStorageAdapter();
        const fileBuffer = await storage.download(file.storagePath);

        fileHash = createHash("sha256").update(fileBuffer).digest("hex");
        await db.trackedItemFile.updateMany({
          where: { trackedItemId, storagePath: file.storagePath },
          data: { fileHash },
        });

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
          // Portal comparison consumes only label/value/rawText — request the lean
          // schema so the throughput-bound local model emits ~40% fewer output tokens.
          compactSchema: true,
        });

        const durationMs = Date.now() - t0;
        // ── Per-attachment observability (Phase 5) ──
        logger.info(
          {
            trackedItemId,
            fileName: file.originalName,
            provider: displayProvider,
            model: visionModel,
            durationMs,
            fieldCount: extraction.fields.length,
            promptTokens: extraction.usage?.promptTokens,
            completionTokens: extraction.usage?.completionTokens,
            finishReason: extraction.finishReason,
            truncated: extraction.truncated ?? false,
          },
          "[worker] Attachment extraction metrics"
        );

        if (extraction.truncated) {
          await emitItemEvent(trackedItemId, "AI_EXTRACT_TRUNCATED", {
            fileName: file.originalName,
            note: "Response hit max_tokens limit — partial extraction",
          });
        }

        await emitItemEvent(
          trackedItemId,
          "AI_EXTRACT_DONE",
          {
            fileName: file.originalName,
            fieldCount: extraction.fields.length,
            model: visionModel,
            promptTokens: extraction.usage?.promptTokens,
            completionTokens: extraction.usage?.completionTokens,
            finishReason: extraction.finishReason,
          },
          { durationMs }
        );

        return {
          ok: true,
          fileName: file.originalName,
          mimeType: file.mimeType,
          storagePath: file.storagePath,
          buffer: fileBuffer,
          fileHash,
          documentType: extraction.documentType,
          fields: extraction.fields.map((f) => ({ label: f.label, value: f.value, rawText: f.rawText })),
        };
      } catch (err) {
        logger.warn({ err, fileName: file.originalName }, "[worker] Failed to extract from file");
        await emitFailureEvent(trackedItemId, "AI_EXTRACT_FAIL", err);
        return { ok: false, fileName: file.originalName, mimeType: file.mimeType, fileHash };
      }
    }
  );

  // Merge in input order — deterministic, and avoids races on the shared maps.
  const pdfFields: Record<string, string> = {};
  const pdfRawFields: Record<string, string> = {};
  const pdfFieldSources: Record<string, string> = {};
  const fileExtractions: ExtractionResult["fileExtractions"] = [];
  const tamperingTargets: ExtractionResult["tamperingTargets"] = [];
  const fileBuffers = new Map<string, Buffer>();
  const failedFiles: string[] = [];

  for (const r of perFile) {
    // Tampering (cross-item hash) coverage applies to every file we hashed —
    // including ones whose extraction later failed — so a duplicated/tampered
    // but unreadable document is still flagged.
    if (r.mimeType === "application/pdf" && r.fileHash && !tamperingTargets.some((t) => t.fileName === r.fileName)) {
      tamperingTargets.push({ fileName: r.fileName, fileHash: r.fileHash });
    }
    if (!r.ok) {
      failedFiles.push(r.fileName);
      continue;
    }
    fileBuffers.set(r.storagePath, r.buffer);
    for (const field of r.fields) {
      pdfFields[field.label] = field.value;
      pdfRawFields[field.label] = field.rawText ?? field.value;
      pdfFieldSources[field.label] = r.fileName;
    }
    fileExtractions.push({
      fileName: r.fileName,
      documentType: r.documentType,
      fields: r.fields.map((f) => ({ label: f.label, value: f.value })),
    });
  }

  return { pdfFields, pdfRawFields, pdfFieldSources, fileExtractions, tamperingTargets, fileBuffers, failedFiles, cachedDocTypes };
}

export async function runIntelligencePipeline({
  trackedItemId,
  portalId,
  portalItemId,
  userId,
  fileExtractions,
  tamperingTargets,
  pdfRawFields,
  effectiveDetailData,
  listData,
  acceptableDocumentTypeIds,
  cachedDocTypes,
}: {
  trackedItemId: string;
  portalId: string;
  portalItemId: string;
  userId: string;
  fileExtractions: ExtractionResult["fileExtractions"];
  tamperingTargets: ExtractionResult["tamperingTargets"];
  pdfRawFields: Record<string, string>;
  effectiveDetailData: Record<string, string>;
  listData?: Record<string, string>;
  acceptableDocumentTypeIds: string[];
  cachedDocTypes?: DocTypeRecord[];
}): Promise<{
  classifiedDocs: { documentTypeId: string | null; documentTypeName: string | null; fileName: string }[];
  /** Rule 5: a foreign-currency amount was detected → the caller flags the claim. */
  foreignCurrencyDetected: boolean;
}> {
  let docTypeById: Map<string, DocTypeRecord> | undefined;
  if (cachedDocTypes) {
    docTypeById = new Map(cachedDocTypes.map((dt) => [dt.id, dt]));
  }

  await db.validationResult.deleteMany({
    where: {
      trackedItemId,
      ruleType: { in: ["TAMPERING", "REQUIRED_FIELD", "DOC_TYPE_MATCH"] },
    },
  });

  const tamperingResults = await Promise.allSettled(
    tamperingTargets.map(({ fileName, fileHash }) =>
      checkTampering(trackedItemId, portalId, portalItemId, fileName, fileHash)
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
        // Completeness check only — document duplicate detection was removed.
        try {
          await validateRequiredFields(
            { name: matchedDocType?.name ?? ext.documentType, requiredFields: matchedDocType?.requiredFields },
            ext.fields,
            { trackedItemId }
          );
        } catch (err) {
          logger.warn({ err, trackedItemId }, "[worker] Completeness check failed (non-fatal)");
        }
      }
    } catch (intErr) {
      logger.warn({ err: intErr, fileName: ext.fileName }, "[worker] Intelligence pipeline error (non-fatal)");
    }
  }

  if (acceptableDocumentTypeIds.length > 0) {
    const acceptableTypeNames = acceptableDocumentTypeIds
      .map((tid) => docTypeById?.get(tid)?.name ?? "Unknown");
    const primary = classifiedDocs[0];
    try {
      await checkDocTypeMatch(
        primary?.documentTypeId ?? null,
        primary?.documentTypeName ?? null,
        acceptableDocumentTypeIds,
        acceptableTypeNames,
        { trackedItemId }
      );
    } catch (intErr) {
      logger.warn({ err: intErr }, "[worker] Doc type match check error (non-fatal)");
    }
  }

  // Rule 5: detect + convert foreign currency. Awaited (not fire-and-forget) so
  // its detection result can flag the claim; still non-fatal on error.
  let foreignCurrencyDetected = false;
  if (Object.keys(pdfRawFields).length > 0) {
    const allPageData = { ...(listData ?? {}), ...effectiveDetailData };
    try {
      foreignCurrencyDetected = await checkForeignCurrency(trackedItemId, pdfRawFields, allPageData);
    } catch (err) {
      logger.warn({ err, trackedItemId }, "[worker] Currency check failed (non-fatal)");
    }
  }

  return { classifiedDocs, foreignCurrencyDetected };
}
