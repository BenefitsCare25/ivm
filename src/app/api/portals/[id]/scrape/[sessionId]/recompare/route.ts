import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { compareFields } from "@/lib/ai/comparison";
import { getFullComparisonSystemPrompt, buildFullComparisonUserPrompt } from "@/lib/ai/prompt-builder";
import { filterFieldsByTemplate, itemMatchesGroupingKey, filterComparisonsByTemplate } from "@/lib/comparison-templates";
import { withCodeRuleResults } from "@/lib/business-rules/evaluate-code-rules";
import { buildBusinessRuleValidations } from "@/lib/business-rules/persist";
import { runVisionChecks, type VisionCheckFile } from "@/lib/ai/vision-checks";
import { annotateSourceFiles } from "@/workers/item-detail-comparison";
import { toInputJson } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { snapshotPortalDayAsync } from "@/lib/portal-metrics";
import type { TemplateField, RequiredDocument, BusinessRule, RequiredDocumentCheck } from "@/types/portal";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, groupingFields: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      select: { id: true, createdAt: true },
    });
    if (!scrapeSession) throw new NotFoundError("Session");

    const body = await req.json();
    const templateId = body.templateId as string;
    if (!templateId) throw new ValidationError("templateId is required");

    const template = await db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
      include: { comparisonConfig: { select: { groupingFields: true } } },
    });
    if (!template) throw new NotFoundError("Template");

    const groupingFields = (
      (template.comparisonConfig?.groupingFields as string[] | null) ??
      (portal.groupingFields as string[]) ??
      []
    );
    const templateKey = template.groupingKey as Record<string, string>;

    // Find items that match this template's grouping key and have no template-based comparison (or already have this template)
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        scrapeSession: { portalId: id },
        status: { in: ["COMPARED", "FLAGGED"] },
        OR: [
          { comparisonResult: { templateId: null } },
          { comparisonResult: { templateId: template.id } },
        ],
      },
      include: {
        comparisonResult: true,
        files: true,
      },
    });

    const matchingItems = items.filter((item) => {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...((item.detailData as Record<string, string>) ?? {}),
      };
      return itemMatchesGroupingKey(groupingFields, allData, templateKey);
    });

    if (matchingItems.length === 0) {
      return NextResponse.json({ recompared: 0 });
    }

    const { provider, apiKey, textModel, visionModel, baseURL, displayProvider } = await resolveProviderAndKey(session.user.id);
    const templateFields = template.fields as unknown as TemplateField[];
    const templateRequiredDocuments = template.requiredDocuments as unknown as RequiredDocument[];
    const templateBusinessRules = template.businessRules as unknown as BusinessRule[];
    const resolvedTemplateId = template.id;
    const useFullPrompt = templateBusinessRules.length > 0 || templateRequiredDocuments.length > 0;

    const rdByNameMap = new Map(templateRequiredDocuments.map((rd) => [rd.documentTypeName, rd]));
    const CONCURRENCY = 5;
    let recompared = 0;

    async function processOne(item: typeof matchingItems[0]): Promise<boolean> {
      const detailData = (item.detailData as Record<string, string>) ?? {};
      if (Object.keys(detailData).length === 0) return false;

      // Reconstruct pdf fields and source file map from existing comparison result
      const existingComparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pdfValue: string | null;
        sourceFile?: string;
      }>;
      const pdfFields: Record<string, string> = {};
      const pdfFieldSources: Record<string, string> = {};
      for (const c of existingComparisons) {
        if (c.pdfValue != null) pdfFields[c.fieldName] = c.pdfValue;
        if (c.sourceFile) pdfFieldSources[c.fieldName] = c.sourceFile;
      }

      const { filteredPageFields, filteredPdfFields } = filterFieldsByTemplate(
        detailData,
        pdfFields,
        templateFields
      );

      if (
        Object.keys(filteredPageFields).length === 0 &&
        Object.keys(filteredPdfFields).length === 0
      )
        return false;

      const systemPromptOverride = useFullPrompt ? getFullComparisonSystemPrompt() : undefined;
      const userPromptOverride = useFullPrompt ? buildFullComparisonUserPrompt({
        fields: templateFields,
        businessRules: templateBusinessRules,
        requiredDocuments: templateRequiredDocuments,
        pageFields: filteredPageFields,
        pdfFields: filteredPdfFields,
        documentTypesFound: [],
      }) : undefined;

      const result = await compareFields({
        pageFields: filteredPageFields,
        pdfFields: filteredPdfFields,
        provider,
        apiKey,
        model: textModel,
        baseURL,
        templateFields,
        systemPromptOverride,
        userPromptOverride,
      });

      // Filter out extra field comparisons the AI added beyond the template config
      if (templateFields.length > 0) {
        result.fieldComparisons = filterComparisonsByTemplate(result.fieldComparisons, templateFields);
        result.matchCount = result.fieldComparisons.filter((c) => c.status === "MATCH").length;
        result.mismatchCount = result.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
      }

      result.fieldComparisons = annotateSourceFiles(result.fieldComparisons, pdfFieldSources);

      // Merge deterministic code-rule results (evaluated in-process). Note: recompare
      // only has the previously-compared PDF fields available (files are not re-extracted),
      // so a code rule referencing an un-mapped PDF field resolves to NOT_APPLICABLE here.
      const mergedData = {
        ...filteredPdfFields,
        ...((item.listData as Record<string, string>) ?? {}),
        ...detailData,
      };
      result.businessRuleResults = withCodeRuleResults(
        result.businessRuleResults,
        templateBusinessRules,
        mergedData
      );

      // Selective vision re-verification — same path as the worker, using the
      // item's stored files (skipped gracefully if files were cleaned by retention).
      const visionFiles: VisionCheckFile[] = item.files
        .filter((f) => f.mimeType === "application/pdf" || f.mimeType.startsWith("image/"))
        .map((f) => ({ originalName: f.originalName, storagePath: f.storagePath, mimeType: f.mimeType }));
      if (
        visionFiles.length > 0 &&
        (templateFields.some((f) => f.verifyWithVision) || templateBusinessRules.some((r) => r.verifyWithVision))
      ) {
        try {
          await runVisionChecks({
            comparisonResult: result,
            fields: templateFields,
            businessRules: templateBusinessRules,
            files: visionFiles,
            pdfFieldSources,
            provider,
            apiKey,
            visionModel,
            baseURL,
          });
        } catch (visionErr) {
          logger.warn({ err: visionErr, itemId: item.id }, "[recompare] Vision verification failed (non-fatal)");
        }
      }

      const comparisonData = {
        provider: displayProvider,
        templateId: resolvedTemplateId,
        fieldComparisons: toInputJson(result.fieldComparisons),
        matchCount: result.matchCount,
        mismatchCount: result.mismatchCount,
        summary: result.summary,
        diagnosisAssessment: result.diagnosisAssessment ? toInputJson(result.diagnosisAssessment) : null,
        completedAt: new Date(),
      };
      await db.comparisonResult.upsert({
        where: { trackedItemId: item.id },
        create: { trackedItemId: item.id, ...comparisonData },
        update: comparisonData,
      });

      // Clear old business rule + required document validation results
      await db.validationResult.deleteMany({
        where: {
          trackedItemId: item.id,
          ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT"] },
        },
      });

      const { validations: ruleValidations, anyFlag: ruleFlag } = buildBusinessRuleValidations(
        templateBusinessRules,
        result.businessRuleResults ?? []
      );

      const validationInserts = [
        ...ruleValidations.map((v) =>
          db.validationResult.create({
            data: {
              trackedItemId: item.id,
              ruleType: v.ruleType,
              status: v.status,
              message: v.message,
              metadata: toInputJson(v.metadata),
            },
          })
        ),
        ...(result.requiredDocumentsCheck ?? [])
          .filter((d: RequiredDocumentCheck) => !d.found)
          .map((d: RequiredDocumentCheck) => {
            const matchedReqDoc = rdByNameMap.get(d.documentTypeName);
            return db.validationResult.create({
              data: {
                trackedItemId: item.id,
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
          }),
      ];
      if (validationInserts.length > 0) await Promise.all(validationInserts);

      const hasMismatch = result.mismatchCount > 0;
      const hasMissingDoc = result.requiredDocumentsCheck?.some((d: RequiredDocumentCheck) => !d.found) ?? false;
      await db.trackedItem.update({
        where: { id: item.id },
        data: { status: (hasMismatch || ruleFlag || hasMissingDoc) ? "FLAGGED" : "COMPARED" },
      });
      return true;
    }

    for (let i = 0; i < matchingItems.length; i += CONCURRENCY) {
      const batch = matchingItems.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(processOne));
      recompared += results.filter((r) => r.status === "fulfilled" && r.value === true).length;
      results.forEach((r, idx) => {
        if (r.status === "rejected") {
          logger.warn({ err: r.reason, itemId: batch[idx].id }, "[recompare] Failed to recompare item");
        }
      });
    }

    if (recompared > 0) {
      snapshotPortalDayAsync(id, scrapeSession.createdAt, "recompare");
    }

    return NextResponse.json({ recompared, total: matchingItems.length });
  } catch (err) {
    return errorResponse(err);
  }
}
