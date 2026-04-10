import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireAuthApi();

    const userId = session.user.id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trackedItemsRaw = await db.trackedItem.findMany({
      where: { scrapeSession: { portal: { userId } } },
      select: { id: true },
    });
    const trackedItemIds = trackedItemsRaw.map((i) => i.id);
    const validationWhere =
      trackedItemIds.length > 0
        ? {
            createdAt: { gte: sevenDaysAgo },
            trackedItemId: { in: trackedItemIds },
          }
        : { createdAt: { gte: sevenDaysAgo }, id: { in: [] as string[] } };

    const [
      docTypesAll,
      docTypesActive,
      docSetsAll,
      docSetsActive,
      businessRulesAll,
      businessRulesActive,
      runsSum,
      extractionAll,
      extractionActive,
      validations,
      recentValidationResults,
    ] = await Promise.all([
      db.documentType.count({ where: { userId } }),
      db.documentType.count({ where: { userId, isActive: true } }),
      db.documentSet.count({ where: { userId } }),
      db.documentSet.count({ where: { userId, isActive: true } }),
      db.businessRule.count({ where: { userId } }),
      db.businessRule.count({ where: { userId, isActive: true } }),
      db.businessRule.aggregate({ where: { userId }, _sum: { runCount: true } }),
      db.extractionTemplate.count({ where: { userId } }),
      db.extractionTemplate.count({ where: { userId, isActive: true } }),
      db.validationResult.groupBy({
        by: ["status"],
        where: validationWhere,
        _count: { _all: true },
      }),
      db.validationResult.findMany({
        where: validationWhere,
        select: { metadata: true },
        take: 200,
      }),
    ]);

    const recentValidations = { pass: 0, fail: 0, warning: 0 };
    for (const v of validations) {
      if (v.status === "PASS") recentValidations.pass = v._count._all;
      else if (v.status === "FAIL") recentValidations.fail = v._count._all;
      else if (v.status === "WARNING") recentValidations.warning = v._count._all;
    }

    const docTypeCounts = new Map<string, number>();
    for (const r of recentValidationResults) {
      const meta = r.metadata as Record<string, unknown>;
      const name = typeof meta?.documentTypeName === "string" ? meta.documentTypeName : null;
      if (name) docTypeCounts.set(name, (docTypeCounts.get(name) ?? 0) + 1);
    }

    const topDocumentTypes = [...docTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json({
      documentTypes: { total: docTypesAll, active: docTypesActive },
      documentSets: { total: docSetsAll, active: docSetsActive },
      businessRules: {
        total: businessRulesAll,
        active: businessRulesActive,
        totalRuns: runsSum._sum.runCount ?? 0,
      },
      extractionTemplates: { total: extractionAll, active: extractionActive },
      recentValidations,
      topDocumentTypes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
