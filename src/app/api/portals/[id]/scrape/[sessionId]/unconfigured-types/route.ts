import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { clearTemplateCache, findMatchingTemplate } from "@/lib/comparison-templates";

export async function GET(
  _req: NextRequest,
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
      select: { id: true },
    });
    if (!scrapeSession) throw new NotFoundError("Session");

    const groupingFields = (portal.groupingFields ?? []) as string[];
    if (groupingFields.length === 0) {
      return NextResponse.json({ unconfiguredTypes: [], needsGroupingConfig: true });
    }

    // This request may land on a different web process from the one that saved
    // the setup. Refresh once, then reuse the cache while scanning the session.
    clearTemplateCache(id);

    // Find the first config with matching grouping fields to link new templates
    const matchingConfig = await db.comparisonConfig.findFirst({
      where: { portalId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    // Limit discovery work to recent completed comparisons.
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
      take: 500,
    });

    const seen = new Map<
      string,
      {
        groupingKey: Record<string, string>;
        itemId: string;
        fieldOptions: Array<{ name: string; pageValue?: string; pdfValue?: string }>;
      }
    >();

    for (const item of items) {
      const allData = {
        ...(item.listData as Record<string, string>),
        ...((item.detailData as Record<string, string>) ?? {}),
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

      // Use the same grouping + provider-group resolver as normal processing and
      // recompare. A claim type is not configured when its provider scope misses.
      if (await findMatchingTemplate(id, allData)) continue;

      const comparisons = (item.comparisonResult?.fieldComparisons ?? []) as Array<{
        fieldName: string;
        pageValue: string | null;
        pdfValue: string | null;
      }>;

      const fieldOptions = comparisons.map((c) => ({
        name: c.fieldName,
        ...(c.pageValue != null && { pageValue: c.pageValue }),
        ...(c.pdfValue != null && { pdfValue: c.pdfValue }),
      }));

      seen.set(keyStr, {
        groupingKey: keyParts,
        itemId: item.id,
        fieldOptions,
      });
    }

    return NextResponse.json({
      unconfiguredTypes: Array.from(seen.values()),
      needsGroupingConfig: false,
      configId: matchingConfig?.id ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
