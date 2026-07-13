import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { compareFields } from "@/lib/ai/comparison";
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import { findMatchingTemplate, filterFieldsByTemplate, filterComparisonsByTemplate } from "@/lib/comparison-templates";
import { withCodeRuleResults } from "@/lib/business-rules/evaluate-code-rules";
import { buildBusinessRuleValidations } from "@/lib/business-rules/persist";
import { runVisionChecks, type VisionCheckFile } from "@/lib/ai/vision-checks";
import { withEventTracking } from "@/lib/portal-events";
import { toInputJson } from "@/lib/utils";
import {
  recognizeDocuments,
  reconcileRequiredDocChecks,
  buildBillStatusSignal,
  buildDocumentTypesFound,
  buildRequiredDocValidations,
  buildBillStatusValidation,
} from "@/lib/intelligence";
import type { AIProvider } from "@/lib/ai/types";
import type { DocTypeRecord } from "@/lib/intelligence";
import type { MatchedTemplate } from "@/lib/comparison-templates";
import type { TemplateField, RequiredDocumentCheck, BillStatusSignal, TrackedItemStatus } from "@/types/portal";

interface ComparisonInput {
  trackedItemId: string;
  portalId: string;
  listData: Record<string, string>;
  effectiveDetailData: Record<string, string>;
  pdfFields: Record<string, string>;
  pdfFieldSources?: Record<string, string>;
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[];
  /** Downloaded source files, used for selective vision re-verification. */
  downloadedFiles?: VisionCheckFile[];
  /** Names of supported files whose extraction failed (present but unreadable). */
  failedFiles?: string[];
  /** Buffers already downloaded during extraction, reused by vision re-checks. */
  fileBuffers?: Map<string, Buffer>;
  provider: AIProvider;
  apiKey: string;
  textModel: string;
  visionModel: string;
  baseURL?: string;
  displayProvider: string;
  comparisonModel: string | null;
  /** User's Document Type library — used for alias-aware document recognition. */
  cachedDocTypes?: DocTypeRecord[];
}

interface ComparisonOutput {
  mismatchCount: number;
  noDocuments: boolean;
  extractionFailed: boolean;
  finalStatus: TrackedItemStatus;
  /** Human-readable reason when the item needs review (set on extraction failures). */
  reviewMessage: string | null;
}

export async function runComparison(input: ComparisonInput): Promise<ComparisonOutput> {
  const {
    trackedItemId, portalId, listData, effectiveDetailData, pdfFields,
    pdfFieldSources, fileExtractions, downloadedFiles, fileBuffers, provider, apiKey, textModel,
    visionModel, baseURL, displayProvider, comparisonModel, cachedDocTypes,
  } = input;

  const hasDetailData = Object.keys(effectiveDetailData ?? {}).length > 0;
  const hasPdfFields = Object.keys(pdfFields ?? {}).length > 0;

  // Distinguish three failure modes so an unreadable document is never mistaken
  // for an absent one (the false "Missing Document" bug). Keyed on what actually
  // happened to the *supported* files (a failed extraction lands in failedFiles):
  //   • noDocuments        — nothing extracted and nothing failed → genuinely require docs
  //   • allExtractionsFailed — supported files were read but ALL failed → ERROR
  //   • partialFailure     — some read, some failed → comparison is incomplete → review
  const failedFiles = input.failedFiles ?? [];
  const noDocuments = fileExtractions.length === 0 && failedFiles.length === 0;
  const allExtractionsFailed = fileExtractions.length === 0 && failedFiles.length > 0;
  const partialFailure = fileExtractions.length > 0 && failedFiles.length > 0;
  const extractionFailed = allExtractionsFailed;

  // Alias-aware, deterministic recognition of every submitted document
  // (canonical type, billing-document family, interim/final bill status).
  const recognizedDocs = recognizeDocuments(fileExtractions, cachedDocTypes ?? []);
  const billStatusSignal = buildBillStatusSignal(recognizedDocs);

  let comparisonResult;
  let templateId: string | null = null;
  let matchedTemplate: MatchedTemplate | null = null;

  if (hasDetailData && hasPdfFields) {
    const allPageData = { ...listData, ...effectiveDetailData };
    const template = await findMatchingTemplate(portalId, allPageData);
    matchedTemplate = template;

    let comparePageFields = effectiveDetailData;
    let comparePdfFields = pdfFields;
    let templateFields: TemplateField[] | undefined;

    // Feed the LLM the raw type AND the alias-resolved canonical name + billing
    // family, so it can match required documents even when the title differs.
    const documentTypesFound = buildDocumentTypesFound(recognizedDocs);

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
          model: comparisonModel ?? textModel,
          baseURL,
          templateFields,
          systemPromptOverride,
          userPromptOverride,
        })
      );
    }
  }

  let ruleFlag = false;
  let preservedPrior = false;

  if (comparisonResult) {
    if (matchedTemplate && matchedTemplate.fields.length > 0) {
      comparisonResult.fieldComparisons = filterComparisonsByTemplate(
        comparisonResult.fieldComparisons,
        matchedTemplate.fields
      );
      comparisonResult.matchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MATCH").length;
      comparisonResult.mismatchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
    }

    // ── Deterministic code rules (evaluated in-process, merged with AI results) ──
    if (matchedTemplate) {
      const mergedData = { ...pdfFields, ...listData, ...effectiveDetailData };
      comparisonResult.businessRuleResults = withCodeRuleResults(
        comparisonResult.businessRuleResults,
        matchedTemplate.businessRules,
        mergedData
      );
    }

    comparisonResult.fieldComparisons = annotateSourceFiles(
      comparisonResult.fieldComparisons,
      pdfFieldSources
    );

    // ── Deterministic required-document reconciliation ──
    // Alias library + billing-document family matching corrects the LLM's
    // false "not found" results (e.g. interim summary bill ↔ Summary Tax Invoice).
    if (matchedTemplate && matchedTemplate.requiredDocuments.length > 0) {
      comparisonResult.requiredDocumentsCheck = reconcileRequiredDocChecks(
        comparisonResult.requiredDocumentsCheck,
        matchedTemplate.requiredDocuments,
        recognizedDocs
      );
    }

    // ── Selective vision re-verification of flagged fields / rules ──
    if (
      matchedTemplate &&
      downloadedFiles &&
      downloadedFiles.length > 0 &&
      (matchedTemplate.fields.some((f) => f.verifyWithVision) ||
        matchedTemplate.businessRules.some((r) => r.verifyWithVision))
    ) {
      try {
        await runVisionChecks({
          comparisonResult,
          fields: matchedTemplate.fields,
          businessRules: matchedTemplate.businessRules,
          files: downloadedFiles,
          pdfFieldSources,
          preloadedBuffers: fileBuffers,
          provider,
          apiKey,
          visionModel,
          baseURL,
        });
      } catch (err) {
        logger.warn({ err, trackedItemId }, "[worker] Vision verification failed (non-fatal)");
      }
    }

    // Clobber guard: on a partial extraction failure, don't overwrite a richer
    // previous comparison (e.g. a full successful run) with this incomplete one.
    const newCompared = (comparisonResult.matchCount ?? 0) + (comparisonResult.mismatchCount ?? 0);
    if (partialFailure) {
      const prior = await priorComparisonRichness(trackedItemId);
      if (prior && (prior.compared > newCompared || prior.docCount > fileExtractions.length)) {
        preservedPrior = true;
        logger.warn(
          { trackedItemId, failedFiles, priorCompared: prior.compared, newCompared },
          "[worker] Partial extraction failure — preserving richer previous comparison result"
        );
      }
    }

    if (!preservedPrior) {
      const documentTypesByFile = Object.fromEntries(
        fileExtractions.map((e) => [e.fileName, e.documentType])
      );
      ruleFlag = await saveComparisonResult(
        trackedItemId, comparisonResult, displayProvider, templateId, matchedTemplate,
        billStatusSignal, documentTypesByFile,
        partialFailure ? { partialFailure: true, unreadableFiles: failedFiles } : undefined
      );
    }
  }

  const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
  // Any unfound required document surfaces the item for review. Deterministic
  // synonym/alias matching has already flipped false positives to found, so what
  // remains is either genuinely missing (FAIL) or low-confidence (WARNING —
  // "manual review recommended"); both warrant a human look.
  const hasMissingDoc = comparisonResult?.requiredDocumentsCheck?.some(
    (d: RequiredDocumentCheck) => !d.found
  ) ?? false;

  // A partial failure always surfaces the item — the comparison ran on incomplete
  // data, so a clean "COMPARED" would be misleading.
  const finalStatus: TrackedItemStatus = noDocuments
    ? "REQUIRE_DOC"
    : allExtractionsFailed
      ? "ERROR"
      : (preservedPrior || partialFailure || hasMismatch || ruleFlag || hasMissingDoc)
        ? "FLAGGED"
        : "COMPARED";

  const reviewMessage: string | null = allExtractionsFailed
    ? `AI could not read any of the ${failedFiles.length} submitted document(s): ${failedFiles.join(", ")}. Manual review required.`
    : preservedPrior
      ? `Re-read failed for ${failedFiles.length} document(s): ${failedFiles.join(", ")}. Showing the previous comparison — manual review recommended.`
      : partialFailure
        ? `${failedFiles.length} document(s) could not be read: ${failedFiles.join(", ")}. Comparison may be incomplete — manual review recommended.`
        : null;

  return {
    mismatchCount: comparisonResult?.mismatchCount ?? 0,
    noDocuments,
    extractionFailed,
    finalStatus,
    reviewMessage,
  };
}

/** Richness of any already-saved comparison — used to avoid clobbering it with a degraded re-run. */
async function priorComparisonRichness(
  trackedItemId: string
): Promise<{ compared: number; docCount: number } | null> {
  const prior = await db.comparisonResult.findUnique({
    where: { trackedItemId },
    select: { matchCount: true, mismatchCount: true, documentTypesByFile: true },
  });
  if (!prior) return null;
  const docCount =
    prior.documentTypesByFile && typeof prior.documentTypesByFile === "object"
      ? Object.keys(prior.documentTypesByFile as Record<string, unknown>).length
      : 0;
  return { compared: (prior.matchCount ?? 0) + (prior.mismatchCount ?? 0), docCount };
}

async function saveComparisonResult(
  trackedItemId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  comparisonResult: any,
  displayProvider: string,
  templateId: string | null,
  matchedTemplate: MatchedTemplate | null,
  billStatusSignal: BillStatusSignal | null,
  documentTypesByFile: Record<string, string>,
  failureContext?: { partialFailure: boolean; unreadableFiles: string[] },
): Promise<boolean> {
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
    documentTypesByFile: toInputJson(documentTypesByFile),
    completedAt: new Date(),
  };
  await db.comparisonResult.upsert({
    where: { trackedItemId },
    create: { trackedItemId, ...comparisonData },
    update: comparisonData,
  });

  await db.validationResult.deleteMany({
    where: { trackedItemId, ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT", "BILL_STATUS"] } },
  });

  let ruleFlag = false;

  if (comparisonResult.businessRuleResults && matchedTemplate) {
    const { validations, anyFlag } = buildBusinessRuleValidations(
      matchedTemplate.businessRules,
      comparisonResult.businessRuleResults
    );
    ruleFlag = anyFlag;
    if (validations.length > 0) {
      await Promise.all(
        validations.map((v) =>
          db.validationResult.create({
            data: {
              trackedItemId,
              ruleType: v.ruleType,
              status: v.status,
              message: v.message,
              metadata: toInputJson(v.metadata),
            },
          })
        )
      );
    }
  }

  const billRow = buildBillStatusValidation(billStatusSignal);
  const extraRows = [
    ...(matchedTemplate
      ? buildRequiredDocValidations(comparisonResult.requiredDocumentsCheck, matchedTemplate.requiredDocuments)
      : []),
    ...(billRow ? [billRow] : []),
  ];

  // On a partial extraction failure, a required document could well be inside a
  // file we couldn't read — so never assert a hard "missing". Downgrade any such
  // FAIL to a manual-review WARNING and add a prominent unreadable-files note.
  if (failureContext?.partialFailure) {
    const unreadable = failureContext.unreadableFiles.join(", ");
    for (const row of extraRows) {
      if (row.ruleType === "REQUIRED_DOCUMENT" && row.status === "FAIL") {
        row.status = "WARNING";
        row.message = `Manual review — "${row.metadata.documentTypeName ?? "required document"}" not found, but ${failureContext.unreadableFiles.length} document(s) could not be read (${unreadable})`;
        row.metadata.severity = "review";
        row.metadata.unreadableFiles = failureContext.unreadableFiles;
      }
    }
    extraRows.push({
      ruleType: "REQUIRED_DOCUMENT",
      status: "WARNING",
      message: `${failureContext.unreadableFiles.length} document(s) could not be read and were excluded from comparison: ${unreadable}. Manual review recommended.`,
      metadata: { severity: "review", reason: "extraction_failed", unreadableFiles: failureContext.unreadableFiles },
    });
  }

  if (extraRows.length > 0) {
    await Promise.all(
      extraRows.map((v) =>
        db.validationResult.create({
          data: {
            trackedItemId,
            ruleType: v.ruleType,
            status: v.status,
            message: v.message,
            metadata: toInputJson(v.metadata),
          },
        })
      )
    );
  }

  return ruleFlag;
}

export function annotateSourceFiles<T extends { fieldName: string; sourceFile?: string }>(
  comparisons: T[],
  sources: Record<string, string> | undefined
): T[] {
  if (!sources) return comparisons;
  return comparisons.map((fc) => {
    const src = sources[fc.fieldName];
    return src ? { ...fc, sourceFile: src } : fc;
  });
}
