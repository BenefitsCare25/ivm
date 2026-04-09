import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { itemMatchesGroupingKey } from "@/lib/comparison-templates";

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

    // Fetch templates once — avoids N+1 inside the item loop
    const [items, existingTemplates] = await Promise.all([
      db.trackedItem.findMany({
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
      }),
      db.comparisonTemplate.findMany({ where: { portalId: id } }),
    ]);

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

      // Check if a template already covers this grouping key (in-memory, no DB call)
      const hasTemplate = existingTemplates.some((t) =>
        itemMatchesGroupingKey(groupingFields, allData, t.groupingKey as Record<string, string>)
      );
      if (hasTemplate) continue;

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
    });
  } catch (err) {
    return errorResponse(err);
  }
}
