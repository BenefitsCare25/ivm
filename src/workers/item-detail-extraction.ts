import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { extractFieldsFromDocument } from "@/lib/ai";
import { classifyDocumentType, fetchDocTypes, validateRequiredFields, checkDocTypeMatch, checkDuplicate, checkTampering } from "@/lib/intelligence";
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
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[];
  tamperingTargets: { fileName: string; fileHash: string }[];
  cachedDocTypes?: DocTypeRecord[];
}

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
  const pdfFields: Record<string, string> = {};
  const pdfRawFields: Record<string, string> = {};
  const fileExtractions: ExtractionResult["fileExtractions"] = [];
  const tamperingTargets: ExtractionResult["tamperingTargets"] = [];

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

        const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
        await db.trackedItemFile.updateMany({
          where: { trackedItemId, storagePath: file.storagePath },
          data: { fileHash },
        });
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

  return { pdfFields, pdfRawFields, fileExtractions, tamperingTargets, cachedDocTypes };
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
  acceptableDocumentTypeIds: string[];
  cachedDocTypes?: DocTypeRecord[];
}): Promise<{ documentTypeId: string | null; documentTypeName: string | null; fileName: string }[]> {
  let docTypeById: Map<string, DocTypeRecord> | undefined;
  if (cachedDocTypes) {
    docTypeById = new Map(cachedDocTypes.map((dt) => [dt.id, dt]));
  }

  await db.validationResult.deleteMany({
    where: {
      trackedItemId,
      ruleType: { in: ["DUPLICATE", "TAMPERING", "REQUIRED_FIELD", "DOC_TYPE_MATCH"] },
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

  if (Object.keys(pdfRawFields).length > 0) {
    checkForeignCurrency(trackedItemId, pdfRawFields, effectiveDetailData).catch((err) =>
      logger.warn({ err, trackedItemId }, "[worker] Currency check failed (non-fatal)")
    );
  }

  return classifiedDocs;
}
