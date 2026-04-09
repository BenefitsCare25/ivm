import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { compareFields } from "@/lib/ai/comparison";
import { filterFieldsByTemplate } from "@/lib/comparison-templates";
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

    // Find items that match this template's grouping key and have no template-based comparison
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        status: { in: ["COMPARED", "FLAGGED"] },
        comparisonResult: { templateId: null },
      },
      include: {
        comparisonResult: true,
      },
    });

    const matchingItems = items.filter((item) => {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...(item.detailData as Record<string, string> ?? {}),
      };
      return groupingFields.every(
        (f) => allData[f]?.toLowerCase().trim() === templateKey[f]?.toLowerCase().trim()
      );
    });

    if (matchingItems.length === 0) {
      return NextResponse.json({ recompared: 0 });
    }

    const { provider, apiKey } = await resolveProviderAndKey(session.user.id);
    const templateFields = template.fields as TemplateField[];
    let recompared = 0;

    for (const item of matchingItems) {
      const detailData = (item.detailData as Record<string, string>) ?? {};
      if (Object.keys(detailData).length === 0) continue;

      // Reconstruct pdf fields from existing comparison result
      const existingComparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pdfValue: string | null;
      }>;
      const pdfFields: Record<string, string> = {};
      for (const c of existingComparisons) {
        if (c.pdfValue) pdfFields[c.fieldName] = c.pdfValue;
      }

      if (Object.keys(pdfFields).length === 0) continue;

      const { filteredPageFields, filteredPdfFields } = filterFieldsByTemplate(
        detailData,
        pdfFields,
        templateFields
      );

      if (
        Object.keys(filteredPageFields).length === 0 &&
        Object.keys(filteredPdfFields).length === 0
      )
        continue;

      try {
        const result = await compareFields({
          pageFields: filteredPageFields,
          pdfFields: filteredPdfFields,
          provider,
          apiKey,
          templateFields,
        });

        // Delete old comparison result and create new one with template
        if (item.comparisonResult) {
          await db.comparisonResult.delete({
            where: { id: item.comparisonResult.id },
          });
        }

        await db.comparisonResult.create({
          data: {
            trackedItemId: item.id,
            provider,
            templateId: template.id,
            fieldComparisons: JSON.parse(JSON.stringify(result.fieldComparisons)),
            matchCount: result.matchCount,
            mismatchCount: result.mismatchCount,
            summary: result.summary,
            completedAt: new Date(),
          },
        });

        const hasMismatch = result.mismatchCount > 0;
        await db.trackedItem.update({
          where: { id: item.id },
          data: { status: hasMismatch ? "FLAGGED" : "COMPARED" },
        });

        recompared++;
      } catch (err) {
        logger.warn({ err, itemId: item.id }, "[recompare] Failed to recompare item");
      }
    }

    return NextResponse.json({ recompared, total: matchingItems.length });
  } catch (err) {
    return errorResponse(err);
  }
}
