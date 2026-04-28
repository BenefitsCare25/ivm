import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { compareFields } from "@/lib/ai/comparison";
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import { findMatchingTemplate, filterFieldsByTemplate, filterComparisonsByTemplate } from "@/lib/comparison-templates";
import { withEventTracking } from "@/lib/portal-events";
import { toInputJson } from "@/lib/utils";
import type { AIProvider } from "@/lib/ai/types";
import type { MatchedTemplate } from "@/lib/comparison-templates";
import type { TemplateField, BusinessRule, RequiredDocument, BusinessRuleResult, RequiredDocumentCheck, TrackedItemStatus } from "@/types/portal";

interface ComparisonInput {
  trackedItemId: string;
  portalId: string;
  listData: Record<string, string>;
  effectiveDetailData: Record<string, string>;
  pdfFields: Record<string, string>;
  pdfFieldSources?: Record<string, string>;
  fileExtractions: { fileName: string; documentType: string; fields: { label: string; value: string }[] }[];
  provider: AIProvider;
  apiKey: string;
  textModel: string;
  baseURL?: string;
  displayProvider: string;
  comparisonModel: string | null;
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
    pdfFieldSources, fileExtractions, provider, apiKey, textModel, baseURL,
    displayProvider, comparisonModel,
  } = input;

  const hasDetailData = Object.keys(effectiveDetailData).length > 0;
  const hasPdfFields = Object.keys(pdfFields).length > 0;
  const noDocuments = fileExtractions.length === 0;
  const extractionFailed = fileExtractions.length > 0 && !hasPdfFields;

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

  if (comparisonResult) {
    if (matchedTemplate && matchedTemplate.fields.length > 0) {
      comparisonResult.fieldComparisons = filterComparisonsByTemplate(
        comparisonResult.fieldComparisons,
        matchedTemplate.fields
      );
      comparisonResult.matchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MATCH").length;
      comparisonResult.mismatchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
    }

    comparisonResult.fieldComparisons = annotateSourceFiles(
      comparisonResult.fieldComparisons,
      pdfFieldSources
    );

    await saveComparisonResult(trackedItemId, comparisonResult, displayProvider, templateId, matchedTemplate);
  }

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
): Promise<void> {
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

  await db.validationResult.deleteMany({
    where: { trackedItemId, ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT"] } },
  });

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
