import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { compareFields } from "@/lib/ai/comparison";
import { filterFieldsByTemplate, itemMatchesGroupingKey } from "@/lib/comparison-templates";
import { logger } from "@/lib/logger";
import type { TemplateField } from "@/types/portal";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, groupingFields: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json();
    const templateId = body.templateId as string;
    if (!templateId) throw new ValidationError("templateId is required");

    const template = await db.comparisonTemplate.findFirst({
      where: { id: templateId, portalId: id },
    });
    if (!template) throw new NotFoundError("Template");

    const groupingFields = (portal.groupingFields ?? []) as string[];
    const templateKey = template.groupingKey as Record<string, string>;

    // Find items that match this template's grouping key and have no template-based comparison (or already have this template)
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        status: { in: ["COMPARED", "FLAGGED"] },
        OR: [
          { comparisonResult: { templateId: null } },
          { comparisonResult: { templateId: template.id } },
        ],
      },
      include: {
        comparisonResult: true,
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

    const { provider, apiKey, textModel } = await resolveProviderAndKey(session.user.id);
    const templateFields = template.fields as unknown as TemplateField[];
    const resolvedTemplateId = template.id;

    const CONCURRENCY = 5;
    let recompared = 0;

    async function processOne(item: typeof matchingItems[0]): Promise<boolean> {
      const detailData = (item.detailData as Record<string, string>) ?? {};
      if (Object.keys(detailData).length === 0) return false;

      // Reconstruct pdf fields from existing comparison result
      const existingComparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pdfValue: string | null;
      }>;
      const pdfFields: Record<string, string> = {};
      for (const c of existingComparisons) {
        if (c.pdfValue != null) pdfFields[c.fieldName] = c.pdfValue;
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

      const result = await compareFields({
        pageFields: filteredPageFields,
        pdfFields: filteredPdfFields,
        provider,
        apiKey,
        model: textModel,
        templateFields,
      });

      const comparisonData = {
        provider,
        templateId: resolvedTemplateId,
        fieldComparisons: JSON.parse(JSON.stringify(result.fieldComparisons)),
        matchCount: result.matchCount,
        mismatchCount: result.mismatchCount,
        summary: result.summary,
        completedAt: new Date(),
      };
      await db.comparisonResult.upsert({
        where: { trackedItemId: item.id },
        create: { trackedItemId: item.id, ...comparisonData },
        update: comparisonData,
      });

      const hasMismatch = result.mismatchCount > 0;
      await db.trackedItem.update({
        where: { id: item.id },
        data: { status: hasMismatch ? "FLAGGED" : "COMPARED" },
      });
      return true;
    }

    for (let i = 0; i < matchingItems.length; i += CONCURRENCY) {
      const batch = matchingItems.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(processOne));
      recompared += results.filter((r) => r.status === "fulfilled" && r.value === true).length;
      results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .forEach((r, idx) => {
          logger.warn({ err: r.reason, itemId: batch[idx].id }, "[recompare] Failed to recompare item");
        });
    }

    return NextResponse.json({ recompared, total: matchingItems.length });
  } catch (err) {
    return errorResponse(err);
  }
}
