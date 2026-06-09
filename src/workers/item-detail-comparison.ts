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
}

export async function runComparison(input: ComparisonInput): Promise<ComparisonOutput> {
  const {
    trackedItemId, portalId, listData, effectiveDetailData, pdfFields,
    pdfFieldSources, fileExtractions, downloadedFiles, fileBuffers, provider, apiKey, textModel,
    visionModel, baseURL, displayProvider, comparisonModel, cachedDocTypes,
  } = input;

  const hasDetailData = Object.keys(effectiveDetailData ?? {}).length > 0;
  const hasPdfFields = Object.keys(pdfFields ?? {}).length > 0;
  const noDocuments = fileExtractions.length === 0;
  const extractionFailed = fileExtractions.length > 0 && !hasPdfFields;

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

    const documentTypesByFile = Object.fromEntries(
      fileExtractions.map((e) => [e.fileName, e.documentType])
    );
    ruleFlag = await saveComparisonResult(
      trackedItemId, comparisonResult, displayProvider, templateId, matchedTemplate, billStatusSignal, documentTypesByFile
    );
  }

  const hasMismatch = (comparisonResult?.mismatchCount ?? 0) > 0;
  // Any unfound required document surfaces the item for review. Deterministic
  // synonym/alias matching has already flipped false positives to found, so what
  // remains is either genuinely missing (FAIL) or low-confidence (WARNING —
  // "manual review recommended"); both warrant a human look.
  const hasMissingDoc = comparisonResult?.requiredDocumentsCheck?.some(
    (d: RequiredDocumentCheck) => !d.found
  ) ?? false;
  const finalStatus = noDocuments
    ? "REQUIRE_DOC"
    : extractionFailed
      ? "ERROR"
      : (hasMismatch || ruleFlag || hasMissingDoc) ? "FLAGGED" : "COMPARED";

  return {
    mismatchCount: comparisonResult?.mismatchCount ?? 0,
    noDocuments,
    extractionFailed,
    finalStatus,
  };
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
