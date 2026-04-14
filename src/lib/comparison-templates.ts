import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";

interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}

interface CachedTemplateEntry {
  id: string;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}

interface CachedPortalTemplates {
  groupingFields: string[];
  templates: CachedTemplateEntry[];
  expiresAt: number;
}

const templateCache = new Map<string, CachedPortalTemplates>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 500;

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
      db.comparisonTemplate.findMany({
        where: { portalId },
        select: { id: true, name: true, groupingKey: true, fields: true, requiredDocuments: true, businessRules: true },
      }),
    ]);
    if (templateCache.size >= CACHE_MAX_SIZE) {
      for (const [key, entry] of templateCache) {
        if (entry.expiresAt < now) templateCache.delete(key);
      }
    }
    cached = {
      groupingFields: (portal?.groupingFields ?? []) as string[],
      templates: templates as unknown as CachedTemplateEntry[],
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
    if (itemMatchesGroupingKey(groupingFields, itemData, template.groupingKey)) {
      return {
        id: template.id,
        name: template.name,
        fields: template.fields,
        requiredDocuments: template.requiredDocuments ?? [],
        businessRules: template.businessRules ?? [],
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
  // Support both old fieldName and new portalFieldName for backward compat
  const fieldNames = new Set(templateFields.map((f) => {
    const name = f.portalFieldName ?? (f as unknown as Record<string, string>).fieldName ?? "";
    return name.toLowerCase().trim();
  }));

  const filteredPageFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageFields)) {
    if (fieldNames.has(key.toLowerCase().trim())) {
      filteredPageFields[key] = value;
    }
  }

  // PDF fields are NOT filtered by template field names.
  // Template field names are portal field names — PDF fields use document-native labels
  // (e.g. "Inv. No.", "Patient Name") that the AI must semantically match. Filtering here
  // would discard all PDF data before the AI can find the match.
  return { filteredPageFields, filteredPdfFields: pdfFields };
}
