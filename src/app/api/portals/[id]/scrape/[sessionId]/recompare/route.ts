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
import {
  fetchDocTypes,
  recognizeDocuments,
  reconcileRequiredDocChecks,
  buildBillStatusSignal,
  buildDocumentTypesFound,
  buildDocumentGroups,
  buildRequiredDocValidations,
  buildBillStatusValidation,
} from "@/lib/intelligence";
import { buildClaimPolicyValidations, buildHospitalSearchText, isFlexClaim } from "@/lib/validations/claim-policy";
import type { TemplateField, RequiredDocument, BusinessRule, RequiredDocumentCheck, TrackedItemStatus } from "@/types/portal";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, groupingFields: true, name: true, baseUrl: true },
    });
    if (!portal) throw new NotFoundError("Portal");
    const flexClaim = isFlexClaim(portal.name, portal.baseUrl);

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

    const cachedDocTypes = await fetchDocTypes(session.user.id).catch(() => []);
    const CONCURRENCY = 5;
    let recompared = 0;

    // Document-intrinsic verdicts (foreign currency, subsidy, GIRO-from-CDA) depend
    // on the source files, which recompare does NOT re-extract — so it must PRESERVE
    // them rather than re-derive from the narrower reconstructed field set (which
    // would silently drop a flag). One batched query maps which items carry any such
    // preserved flag, avoiding a per-item lookup inside the concurrency loop.
    const PRESERVED_DOC_RULE_TYPES = ["CURRENCY_CONVERSION", "SUBSIDY_DEDUCTION", "NON_CLAIMABLE_PAYMENT"];
    const preservedRows = await db.validationResult.findMany({
      where: {
        trackedItemId: { in: matchingItems.map((i) => i.id) },
        ruleType: { in: PRESERVED_DOC_RULE_TYPES },
      },
      select: { trackedItemId: true },
    });
    const itemsWithPreservedFlag = new Set(preservedRows.map((r) => r.trackedItemId));

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

      // Rebuild per-file document evidence from the stored comparison so the
      // deterministic recogniser (alias library, billing family, bill status)
      // runs identically to the worker. The original document-type labels are
      // restored from the persisted `documentTypesByFile` snapshot (files are
      // not re-extracted on recompare); falls back to "" only for legacy results
      // written before that column existed.
      const docTypesByFile = (item.comparisonResult?.documentTypesByFile as Record<string, string> | null) ?? {};
      const fieldsByFile = new Map<string, { label: string; value: string }[]>();
      for (const c of existingComparisons) {
        if (c.pdfValue == null) continue;
        const file = c.sourceFile ?? "document";
        const arr = fieldsByFile.get(file) ?? [];
        arr.push({ label: c.fieldName, value: c.pdfValue });
        fieldsByFile.set(file, arr);
      }
      const reconstructedExtractions = Array.from(fieldsByFile.entries()).map(
        ([fileName, fields]) => ({ fileName, documentType: docTypesByFile[fileName] ?? "", fields })
      );
      const recognizedDocs = recognizeDocuments(reconstructedExtractions, cachedDocTypes);
      const billStatusSignal = buildBillStatusSignal(recognizedDocs);
      const documentTypesFound = buildDocumentTypesFound(recognizedDocs);

      // Per-document provenance so the model sources provider/bill-amount from the
      // billing document (matches the worker's comparison prompt).
      const documentGroups = buildDocumentGroups(recognizedDocs, reconstructedExtractions);

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
        documentTypesFound,
        documentGroups,
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

      // Deterministic required-document reconciliation (alias + billing family).
      if (templateRequiredDocuments.length > 0) {
        result.requiredDocumentsCheck = reconcileRequiredDocChecks(
          result.requiredDocumentsCheck,
          templateRequiredDocuments,
          recognizedDocs
        );
      }

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
        documentTypesByFile: toInputJson(docTypesByFile),
        completedAt: new Date(),
      };
      await db.comparisonResult.upsert({
        where: { trackedItemId: item.id },
        create: { trackedItemId: item.id, ...comparisonData },
        update: comparisonData,
      });

      // Clear old business rule + required document + re-derivable policy results.
      // SUBSIDY_DEDUCTION / NON_CLAIMABLE_PAYMENT / CURRENCY_CONVERSION are
      // document-intrinsic and preserved (see itemsWithPreservedFlag) — do NOT delete.
      await db.validationResult.deleteMany({
        where: {
          trackedItemId: item.id,
          ruleType: { in: ["BUSINESS_RULE", "REQUIRED_DOCUMENT", "BILL_STATUS", "CLAIMANT_MATCH", "WRONG_CLAIM_TYPE", "POSSIBLE_DUPLICATE", "SPECIALIST_REVIEW"] },
        },
      });

      const { validations: ruleValidations, anyFlag: ruleFlag } = buildBusinessRuleValidations(
        templateBusinessRules,
        result.businessRuleResults ?? []
      );

      // Required-document + bill-status rows come from the SAME shared builders
      // as the worker, so both paths emit identical alerts.
      // Global claim-policy checks — identical logic to the worker path.
      const policy = buildClaimPolicyValidations({
        fieldComparisons: result.fieldComparisons,
        flexClaim,
        pageData: { ...((item.listData as Record<string, string>) ?? {}), ...detailData },
        groupingFields,
        documentText: buildHospitalSearchText(reconstructedExtractions, recognizedDocs),
        documentFields: reconstructedExtractions.flatMap((e) => e.fields),
      });

      // Document-intrinsic flags (currency/subsidy/GIRO) are preserved, not
      // re-derived — a subsidy/GIRO signal may live in a document field that was
      // not part of the reconstructed comparison set. Re-derivable policy flags
      // (possible-duplicate, specialist) come from the current evaluation.
      const preservedDocFlag = itemsWithPreservedFlag.has(item.id);
      const policyFlag = policy.possibleDuplicate || policy.specialistReview;

      const billRow = buildBillStatusValidation(billStatusSignal);
      const extraRows = [
        ...buildRequiredDocValidations(result.requiredDocumentsCheck, templateRequiredDocuments),
        ...(billRow ? [billRow] : []),
        // Drop the document-intrinsic policy rows — their persisted originals are
        // authoritative and preserved (not deleted above).
        ...policy.rows.filter(
          (r) => r.ruleType !== "SUBSIDY_DEDUCTION" && r.ruleType !== "NON_CLAIMABLE_PAYMENT"
        ),
      ];
      const validationInserts = [...ruleValidations, ...extraRows].map((v) =>
        db.validationResult.create({
          data: {
            trackedItemId: item.id,
            ruleType: v.ruleType,
            status: v.status,
            message: v.message,
            metadata: toInputJson(v.metadata),
          },
        })
      );
      if (validationInserts.length > 0) await Promise.all(validationInserts);

      const hasMismatch = result.mismatchCount > 0;
      const hasMissingDoc = result.requiredDocumentsCheck?.some((d: RequiredDocumentCheck) => !d.found) ?? false;
      // Missing claimant → "pending document" (REQUIRE_DOC), precedence over FLAGGED.
      const status: TrackedItemStatus = policy.claimantMissing
        ? "REQUIRE_DOC"
        : (hasMismatch || ruleFlag || hasMissingDoc || policy.wrongClaimType || policyFlag || preservedDocFlag)
          ? "FLAGGED"
          : "COMPARED";
      await db.trackedItem.update({
        where: { id: item.id },
        data: { status },
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
