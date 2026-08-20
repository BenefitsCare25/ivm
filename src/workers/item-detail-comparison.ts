import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { compareFields } from "@/lib/ai/comparison";
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import { findMatchingTemplate, filterFieldsByTemplate, filterComparisonsByTemplate } from "@/lib/comparison-templates";
import { withCodeRuleResults } from "@/lib/business-rules/evaluate-code-rules";
import { buildBusinessRuleValidations } from "@/lib/business-rules/persist";
import { runVisionChecks, type VisionCheckFile } from "@/lib/ai/vision-checks";
import {
  applyCurrencyConversionEvidence,
  parseCurrencyConversionEvidence,
  withCurrencyConversionFields,
} from "@/lib/comparison-reconciliation";
import { withEventTracking } from "@/lib/portal-events";
import { toInputJson } from "@/lib/utils";
import {
  recognizeDocuments,
  reconcileRequiredDocChecks,
  buildBillStatusSignal,
  buildDocumentTypesFound,
  buildDocumentGroups,
  buildRequiredDocValidations,
  buildBillStatusValidation,
} from "@/lib/intelligence";
import type { ValidationRowData } from "@/lib/intelligence/validation-builders";
import { buildClaimPolicyValidations, buildHospitalSearchText } from "@/lib/validations/claim-policy";
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
  /** Decided by the worker (before the destructive intelligence step): keep the
   *  previous saved comparison instead of overwriting it with this degraded run. */
  preservePrior?: boolean;
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
  /** Portal is a flex-claim portal (name/URL contains "flex") — gates the wrong-claim-type policy. */
  flexClaim?: boolean;
  /** Portal grouping fields — used to resolve the claim-type value for the policy checks. */
  groupingFields?: string[];
  /** Rule 5: a foreign-currency amount was detected during extraction → flag the claim. */
  foreignCurrency?: boolean;
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

  // Portal-side data for comparison: prefer scraped detail-page fields, but fall
  // back to list-page data when the detail page yielded nothing (an SPA whose
  // detail DOM didn't match the field selectors, or a portal with no separate
  // detail page). The list row still carries comparable fields — claim amount,
  // dates, claimant — so skipping the comparison outright just because the detail
  // scrape was empty produces a false "No comparison data available" on an item
  // we can actually compare.
  const comparablePageData = hasDetailData ? effectiveDetailData : (listData ?? {});
  const hasPageData = Object.keys(comparablePageData).length > 0;

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

  // Fourth mode: a document was submitted and extraction did NOT throw, yet it
  // yielded zero usable fields — a blank/corrupted/unreadable file. Without this
  // it slips through as a clean "COMPARED" (the whole comparison block is gated
  // on hasPdfFields). Only meaningful when nothing was salvageable: at least one
  // file extracted, none threw, and no document fields came out at all.
  const emptyExtraction =
    fileExtractions.length > 0 && failedFiles.length === 0 && !hasPdfFields;
  const unreadableFiles = emptyExtraction ? fileExtractions.map((f) => f.fileName) : [];
  // A degraded re-run must not flip a previously-good item to "unreadable"
  // (the worker sets preservePrior when a richer prior comparison exists).
  const flagUnreadable = emptyExtraction && !(input.preservePrior ?? false);

  // Alias-aware, deterministic recognition of every submitted document
  // (canonical type, billing-document family, interim/final bill status).
  const recognizedDocs = recognizeDocuments(fileExtractions, cachedDocTypes ?? []);
  const billStatusSignal = buildBillStatusSignal(recognizedDocs);
  const documentTypesByFile = Object.fromEntries(
    fileExtractions.map((extraction) => [extraction.fileName, extraction.documentType])
  );
  const currencyRows = input.foreignCurrency
    ? await db.validationResult.findMany({
        where: { trackedItemId, ruleType: "CURRENCY_CONVERSION" },
        select: { metadata: true },
      })
    : [];
  const currencyConversions = currencyRows
    .map((row) => parseCurrencyConversionEvidence(row.metadata))
    .filter((conversion) => conversion !== null);
  const comparisonPdfFields = withCurrencyConversionFields(pdfFields, currencyConversions);

  let comparisonResult;
  let templateId: string | null = null;
  let matchedTemplate: MatchedTemplate | null = null;

  if (hasPageData && hasPdfFields) {
    const allPageData = { ...listData, ...effectiveDetailData };
    const template = await findMatchingTemplate(portalId, allPageData);
    matchedTemplate = template;

    let comparePageFields = comparablePageData;
    let comparePdfFields = comparisonPdfFields;
    let templateFields: TemplateField[] | undefined;

    // Feed the LLM the raw type AND the alias-resolved canonical name + billing
    // family, so it can match required documents even when the title differs.
    const documentTypesFound = buildDocumentTypesFound(recognizedDocs);

    // Per-document provenance: which file each value came from, tagged with its
    // recognized family (Tax Invoice / Referral Letter / …). Lets the model
    // source provider/facility + bill amount from the billing document rather
    // than a referral letter's letterhead (the FUSION MEDICAL vs Gleneagles bug).
    const documentGroups = buildDocumentGroups(recognizedDocs, fileExtractions);

    if (template) {
      templateId = template.id;
      templateFields = template.fields;
      const filtered = filterFieldsByTemplate(comparablePageData, comparisonPdfFields, template.fields);
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
        documentGroups,
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
        matchedTemplate.fields,
        comparisonPdfFields
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
          documentTypesByFile,
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

    if (matchedTemplate && currencyConversions.length > 0) {
      comparisonResult.fieldComparisons = applyCurrencyConversionEvidence(
        comparisonResult.fieldComparisons,
        matchedTemplate.fields,
        currencyConversions
      );
      comparisonResult.matchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MATCH").length;
      comparisonResult.mismatchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
    }

    // Clobber guard: the worker decided up front (before the destructive
    // intelligence step) whether this degraded re-run should keep the previous
    // comparison rather than overwrite it. Honour that decision here too.
    preservedPrior = (input.preservePrior ?? false) && partialFailure;
    if (preservedPrior) {
      logger.warn(
        { trackedItemId, failedFiles },
        "[worker] Partial extraction failure — preserving previous comparison result"
      );
    }

    if (!preservedPrior) {
      ruleFlag = await saveComparisonResult(
        trackedItemId, comparisonResult, displayProvider, templateId, matchedTemplate,
        billStatusSignal, documentTypesByFile,
        partialFailure ? { partialFailure: true, unreadableFiles: failedFiles } : undefined
      );
    }
  }

  // ── Global claim policy checks ──────────────────────────────────────────
  // Evaluated + persisted independently of the comparison: rules 1/3 (subsidy,
  // GIRO-from-CDA) need only document fields, rule 4 (possible duplicate) only
  // portal data, and rule 6 (polyclinic vs hospital) only claim-type + provider
  // — so an item with documents but no comparison (e.g. no portal page fields)
  // is still adjudicated. Skipped entirely when preserving a prior result: on a
  // degraded re-run a document may have transiently failed to extract, and that
  // must NOT flip a previously-good item to a policy verdict.
  let claimantMissing = false;
  let wrongClaimType = false;
  let policyFlag = false;
  const runPolicy =
    !(input.preservePrior ?? false) && !preservedPrior && !noDocuments && !allExtractionsFailed;
  if (runPolicy) {
    const policy = buildClaimPolicyValidations({
      fieldComparisons: comparisonResult?.fieldComparisons ?? [],
      flexClaim: input.flexClaim ?? false,
      pageData: { ...listData, ...effectiveDetailData },
      groupingFields: input.groupingFields ?? [],
      documentText: buildHospitalSearchText(fileExtractions, recognizedDocs),
      documentFields: fileExtractions.flatMap((e) => e.fields),
    });
    claimantMissing = policy.claimantMissing;
    wrongClaimType = policy.wrongClaimType;
    // Rules 1/3/4 (subsidy, non-claimable payment, possible duplicate) and rule 2
    // (specialist review) all flag the item.
    policyFlag =
      policy.subsidyDeduction ||
      policy.nonClaimablePayment ||
      policy.possibleDuplicate ||
      policy.specialistReview;
    await persistPolicyValidations(trackedItemId, policy.rows);
  }

  // Persist a visible alert for the unreadable-document case. The comparison
  // block was skipped (no pdfFields), so no ComparisonResult / validation rows
  // were written — write the alert row directly. Idempotent across re-runs.
  if (flagUnreadable) {
    await db.validationResult.deleteMany({
      where: { trackedItemId, ruleType: "UNREADABLE_DOCUMENT" },
    });
    await db.validationResult.create({
      data: {
        trackedItemId,
        ruleType: "UNREADABLE_DOCUMENT",
        status: "FAIL",
        message: `AI could not read any content from the submitted document(s): ${unreadableFiles.join(", ")}. The file may be blank, corrupted, or an unsupported scan — a readable document is required.`,
        metadata: toInputJson({ severity: "critical", unreadableFiles }),
      },
    });
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
  // data, so a clean "COMPARED" would be misleading. A missing claimant (rule 1)
  // is a "pending document" verdict (REQUIRE_DOC) and takes precedence over FLAGGED.
  const finalStatus: TrackedItemStatus = noDocuments
    ? "REQUIRE_DOC"
    : allExtractionsFailed
      ? "ERROR"
      : flagUnreadable
        ? "REQUIRE_DOC"
        : claimantMissing
          ? "REQUIRE_DOC"
          : (preservedPrior || partialFailure || hasMismatch || ruleFlag || hasMissingDoc ||
             wrongClaimType || policyFlag || (input.foreignCurrency ?? false))
            ? "FLAGGED"
            : "COMPARED";

  const reviewMessage: string | null = allExtractionsFailed
    ? `AI could not read any of the ${failedFiles.length} submitted document(s): ${failedFiles.join(", ")}. Manual review required.`
    : flagUnreadable
      ? `The submitted document(s) could not be read (blank or unreadable): ${unreadableFiles.join(", ")}. A readable document is required.`
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

/**
 * Decide — BEFORE the destructive intelligence/comparison steps — whether this
 * run degraded relative to a prior saved comparison (extracted fewer documents,
 * or extracted none while a prior result exists). When true the worker skips the
 * intelligence rewrite AND the comparison overwrite, so a failed re-read never
 * corrupts a previously-good result. Only meaningful when some extraction failed.
 */
export async function shouldPreservePriorComparison(
  trackedItemId: string,
  extractedCount: number
): Promise<boolean> {
  const prior = await priorComparisonRichness(trackedItemId);
  if (!prior) return false;
  return prior.docCount > extractedCount || (extractedCount === 0 && prior.compared > 0);
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

  // Owns only the comparison-derived rows. The global claim-policy rows
  // (CLAIMANT_MATCH/WRONG_CLAIM_TYPE/SUBSIDY_DEDUCTION/…) are cleared + written
  // separately by persistPolicyValidations, which also runs when there is no
  // comparison — so they must NOT be deleted here.
  await db.validationResult.deleteMany({
    where: {
      trackedItemId,
      ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT", "BILL_STATUS", "UNREADABLE_DOCUMENT"] },
    },
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

/** Global claim-policy rule types — owned by persistPolicyValidations. */
export const POLICY_RULE_TYPES = [
  "CLAIMANT_MATCH", "WRONG_CLAIM_TYPE", "SUBSIDY_DEDUCTION",
  "NON_CLAIMABLE_PAYMENT", "POSSIBLE_DUPLICATE", "SPECIALIST_REVIEW",
] as const;

/**
 * Clear + rewrite the global claim-policy rows for an item. Always deletes the
 * policy rule types first (so a rule that no longer fires is cleared), then
 * inserts whatever the policy produced. Idempotent across re-runs.
 */
async function persistPolicyValidations(
  trackedItemId: string,
  rows: ValidationRowData[]
): Promise<void> {
  await db.validationResult.deleteMany({
    where: { trackedItemId, ruleType: { in: [...POLICY_RULE_TYPES] } },
  });
  if (rows.length === 0) return;
  await Promise.all(
    rows.map((v) =>
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
