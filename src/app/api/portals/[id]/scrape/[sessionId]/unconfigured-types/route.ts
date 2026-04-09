import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { findMatchingTemplate } from "@/lib/comparison-templates";

export async function GET(
  _req: NextRequest,
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

    const groupingFields = (portal.groupingFields ?? []) as string[];
    if (groupingFields.length === 0) {
      return NextResponse.json({ unconfiguredTypes: [], needsGroupingConfig: true });
    }

    // Get completed items that used full comparison (no template)
    const items = await db.trackedItem.findMany({
      where: {
        scrapeSessionId: sessionId,
        status: { in: ["COMPARED", "FLAGGED"] },
        comparisonResult: { templateId: null },
      },
      select: {
        id: true,
        listData: true,
        detailData: true,
        comparisonResult: {
          select: { fieldComparisons: true },
        },
      },
      take: 100,
    });

    // Group by claim type, find unique unconfigured types
    const seen = new Map<
      string,
      {
        groupingKey: Record<string, string>;
        itemId: string;
        pageFields: string[];
        pdfFields: string[];
      }
    >();

    for (const item of items) {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...(item.detailData as Record<string, string> ?? {}),
      };

      const keyParts: Record<string, string> = {};
      let hasAllFields = true;
      for (const f of groupingFields) {
        if (allData[f]) {
          keyParts[f] = allData[f];
        } else {
          hasAllFields = false;
        }
      }
      if (!hasAllFields) continue;

      const keyStr = JSON.stringify(keyParts);
      if (seen.has(keyStr)) continue;

      // Check if template already exists
      const template = await findMatchingTemplate(id, allData);
      if (template) continue;

      // Extract unique field names from comparison result
      const comparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pageValue: string | null;
        pdfValue: string | null;
      }>;

      const pageFieldNames = comparisons
        .filter((c) => c.pageValue != null)
        .map((c) => c.fieldName);
      const pdfFieldNames = comparisons
        .filter((c) => c.pdfValue != null)
        .map((c) => c.fieldName);

      seen.set(keyStr, {
        groupingKey: keyParts,
        itemId: item.id,
        pageFields: [...new Set(pageFieldNames)],
        pdfFields: [...new Set(pdfFieldNames)],
      });
    }

    return NextResponse.json({
      unconfiguredTypes: Array.from(seen.values()),
      needsGroupingConfig: false,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
