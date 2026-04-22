import { db } from "@/lib/db";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeListPage, scrapeDetailPage } from "@/lib/playwright/scraper";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { toInputJson } from "@/lib/utils";
import type { ListSelectors, DetailSelectors, DiscoveredClaimType } from "@/types/portal";

export interface DiscoverFieldsOptions {
  portalId: string;
  userId: string;
  groupingFields: string[];
}

export async function discoverFields(
  options: DiscoverFieldsOptions
): Promise<DiscoveredClaimType[]> {
  const { portalId, userId, groupingFields } = options;

  const portal = await db.portal.findFirst({
    where: { id: portalId, userId },
    include: { credential: true },
  });

  if (!portal) throw new NotFoundError("Portal");
  if (!portal.credential) throw new ValidationError("No authentication configured");

  const listSelectors = (portal.listSelectors ?? {}) as ListSelectors;
  const detailSelectors = (portal.detailSelectors ?? {}) as DetailSelectors;

  const { context, page } = await resolveAuth({
    credential: portal.credential,
    baseUrl: portal.baseUrl,
    listPageUrl: portal.listPageUrl,
  });

  try {
    const rows = await scrapeListPage(page, listSelectors);
    logger.info({ rowCount: rows.length, portalId }, "[discovery] List page scraped");

    const comboMap = new Map<string, { key: Record<string, string>; detailUrl: string }>();

    for (const row of rows) {
      const key: Record<string, string> = {};
      for (const field of groupingFields) {
        key[field] = row.fields[field]?.trim() ?? "";
      }
      const comboKey = groupingFields.map((f) => key[f]).join("|||");

      if (!comboMap.has(comboKey) && row.detailUrl) {
        comboMap.set(comboKey, { key, detailUrl: row.detailUrl });
      }
    }

    logger.info({ comboCount: comboMap.size, portalId }, "[discovery] Unique combos found");

    const results: DiscoveredClaimType[] = [];
    const now = new Date().toISOString();

    for (const { key, detailUrl } of comboMap.values()) {
      try {
        const absoluteUrl = detailUrl.startsWith("http")
          ? detailUrl
          : new URL(detailUrl, portal.baseUrl).href;

        const detailData = await scrapeDetailPage(page, absoluteUrl, detailSelectors);
        const detailFields = Object.keys(detailData);

        results.push({
          groupingKey: key,
          detailFields,
          sampleUrl: absoluteUrl,
          discoveredAt: now,
        });

        logger.info(
          { groupingKey: key, fieldCount: detailFields.length },
          "[discovery] Detail page fields extracted"
        );
      } catch (err) {
        logger.error({ groupingKey: key, detailUrl, err }, "[discovery] Failed to scrape detail page");
      }
    }

    await db.portal.update({
      where: { id: portalId },
      data: {
        discoveredClaimTypes: toInputJson(results),
        groupingFields: toInputJson(groupingFields),
      },
    });

    // Sync grouping fields to the default ComparisonConfig so Comparison Setup
    // reflects what discovery found (create if none exists yet)
    await db.comparisonConfig.upsert({
      where: { portalId_name: { portalId, name: "Claims Configuration" } },
      update: { groupingFields: toInputJson(groupingFields) },
      create: {
        portalId,
        name: "Claims Configuration",
        groupingFields: toInputJson(groupingFields),
      },
    });

    return results;
  } finally {
    await context.close();
  }
}
