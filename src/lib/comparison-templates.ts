import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { TemplateField } from "@/types/portal";

interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
}

const templateCache = new Map<string, {
  groupingFields: string[];
  templates: Array<{ id: string; name: string; groupingKey: unknown; fields: unknown }>;
  expiresAt: number;
}>();
const CACHE_TTL_MS = 60_000;

export function clearTemplateCache(portalId: string): void {
  templateCache.delete(portalId);
}

/** Returns true if `itemData` matches the given template grouping key for all configured fields. */
export function itemMatchesGroupingKey(
  groupingFields: string[],
  itemData: Record<string, string>,
  templateKey: Record<string, string>
): boolean {
  return groupingFields.every(
    (f) => itemData[f]?.toLowerCase().trim() === templateKey[f]?.toLowerCase().trim()
  );
}

/**
 * Find a matching comparison template for an item based on its data and the portal's grouping fields.
 * Returns null if no grouping fields configured or no template matches.
 */
export async function findMatchingTemplate(
  portalId: string,
  itemData: Record<string, string>
): Promise<MatchedTemplate | null> {
  const now = Date.now();
  let cached = templateCache.get(portalId);

  if (!cached || cached.expiresAt < now) {
    const [portal, templates] = await Promise.all([
      db.portal.findUnique({ where: { id: portalId }, select: { groupingFields: true } }),
      db.comparisonTemplate.findMany({ where: { portalId }, select: { id: true, name: true, groupingKey: true, fields: true } }),
    ]);
    cached = {
      groupingFields: (portal?.groupingFields ?? []) as string[],
      templates,
      expiresAt: now + CACHE_TTL_MS,
    };
    templateCache.set(portalId, cached);
  }

  const { groupingFields, templates } = cached;
  if (groupingFields.length === 0) return null;

  // Verify all grouping fields exist in item data
  for (const field of groupingFields) {
    if (itemData[field] == null || !itemData[field].trim()) {
      logger.debug({ field, portalId }, "[templates] Grouping field not found in item data");
      return null;
    }
  }

  for (const template of templates) {
    if (itemMatchesGroupingKey(groupingFields, itemData, template.groupingKey as Record<string, string>)) {
      return {
        id: template.id,
        name: template.name,
        fields: template.fields as unknown as TemplateField[],
      };
    }
  }

  return null;
}

/**
 * Filter page/pdf fields to only those specified in the template.
 * Returns the filtered field maps ready for AI comparison.
 */
export function filterFieldsByTemplate(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): { filteredPageFields: Record<string, string>; filteredPdfFields: Record<string, string> } {
  const fieldNames = new Set(templateFields.map((f) => f.fieldName.toLowerCase().trim()));

  const filteredPageFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPageFields[key] = value;
    }
  }

  const filteredPdfFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pdfFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPdfFields[key] = value;
    }
  }

  return { filteredPageFields, filteredPdfFields };
}
