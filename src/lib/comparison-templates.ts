import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { TemplateField } from "@/types/portal";

interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
}

/**
 * Find a matching comparison template for an item based on its data and the portal's grouping fields.
 * Returns null if no grouping fields configured or no template matches.
 */
export async function findMatchingTemplate(
  portalId: string,
  itemData: Record<string, string>
): Promise<MatchedTemplate | null> {
  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: { groupingFields: true },
  });

  const groupingFields = (portal?.groupingFields ?? []) as string[];
  if (groupingFields.length === 0) return null;

  // Build the grouping key from item data
  const groupingKey: Record<string, string> = {};
  for (const field of groupingFields) {
    const value = itemData[field];
    if (!value) {
      logger.debug({ field, portalId }, "[templates] Grouping field not found in item data");
      return null;
    }
    groupingKey[field] = value;
  }

  // Find template with matching groupingKey
  const templates = await db.comparisonTemplate.findMany({
    where: { portalId },
  });

  for (const template of templates) {
    const tKey = template.groupingKey as Record<string, string>;
    const matches = groupingFields.every(
      (f) => tKey[f]?.toLowerCase().trim() === groupingKey[f]?.toLowerCase().trim()
    );
    if (matches) {
      return {
        id: template.id,
        name: template.name,
        fields: template.fields as TemplateField[],
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
