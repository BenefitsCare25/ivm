import { db } from "@/lib/db";
import type { TemplateField, RequiredDocument, BusinessRule, FieldComparison } from "@/types/portal";

export interface MatchedTemplate {
  id: string;
  name: string;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}

interface CachedTemplateEntry {
  id: string;
  name: string;
  configGroupingFields: string[];
  groupingKey: Record<string, string>;
  providerGroupId: string | null;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
}

interface CachedProviderGroup {
  id: string;
  providerFieldName: string;
  matchMode: "list" | "others";
  normalizedMembers: string[];
}

interface CachedPortalTemplates {
  portalGroupingFields: string[];
  templates: CachedTemplateEntry[];
  providerGroups: Map<string, CachedProviderGroup>;
  expiresAt: number;
}

const templateCache = new Map<string, CachedPortalTemplates>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 500;

export function clearTemplateCache(portalId: string): void {
  templateCache.delete(portalId);
}

export function normalizeForMatch(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export function fuzzyMatchProvider(itemValue: string, normalizedMembers: string[]): boolean {
  const normalized = normalizeForMatch(itemValue);
  return normalizedMembers.some(
    (member) => normalized.includes(member) || member.includes(normalized)
  );
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
 * Find a matching comparison template for an item based on its data.
 * Checks all ComparisonConfigs for the portal, each with its own grouping fields.
 * Falls back to portal-level groupingFields for templates without a config.
 * When multiple templates match the same groupingKey, uses provider groups to disambiguate.
 */
export async function findMatchingTemplate(
  portalId: string,
  itemData: Record<string, string>
): Promise<MatchedTemplate | null> {
  const now = Date.now();
  let cached = templateCache.get(portalId);

  if (!cached || cached.expiresAt < now) {
    const [portal, configs, templates, providerGroups] = await Promise.all([
      db.portal.findUnique({ where: { id: portalId }, select: { groupingFields: true } }),
      db.comparisonConfig.findMany({
        where: { portalId },
        select: { id: true, groupingFields: true },
      }),
      db.comparisonTemplate.findMany({
        where: { portalId },
        select: {
          id: true, name: true, groupingKey: true, fields: true,
          requiredDocuments: true, businessRules: true,
          comparisonConfigId: true, providerGroupId: true,
        },
      }),
      db.providerGroup.findMany({
        where: { portalId },
        select: { id: true, providerFieldName: true, matchMode: true, members: true },
      }),
    ]);

    if (templateCache.size >= CACHE_MAX_SIZE) {
      for (const [key, entry] of templateCache) {
        if (entry.expiresAt < now) templateCache.delete(key);
      }
    }

    const configMap = new Map<string, string[]>();
    for (const c of configs) {
      configMap.set(c.id, (c.groupingFields ?? []) as string[]);
    }
    const portalGroupingFields = (portal?.groupingFields ?? []) as string[];

    const pgMap = new Map<string, CachedProviderGroup>();
    for (const pg of providerGroups) {
      pgMap.set(pg.id, {
        id: pg.id,
        providerFieldName: pg.providerFieldName,
        matchMode: pg.matchMode as "list" | "others",
        normalizedMembers: ((pg.members ?? []) as string[]).map(normalizeForMatch),
      });
    }

    cached = {
      portalGroupingFields,
      templates: templates.map((t) => ({
        ...(t as unknown as CachedTemplateEntry),
        configGroupingFields: t.comparisonConfigId
          ? configMap.get(t.comparisonConfigId) ?? portalGroupingFields
          : portalGroupingFields,
      })),
      providerGroups: pgMap,
      expiresAt: now + CACHE_TTL_MS,
    };
    templateCache.set(portalId, cached);
  }

  const candidates: CachedTemplateEntry[] = [];

  for (const template of cached.templates) {
    const groupingFields = template.configGroupingFields;
    if (groupingFields.length === 0) continue;

    const hasAllFields = groupingFields.every((f) => itemData[f] != null);
    if (!hasAllFields) continue;

    if (itemMatchesGroupingKey(groupingFields, itemData, template.groupingKey)) {
      candidates.push(template);
    }
  }

  if (candidates.length === 0) return null;

  const withoutGroup = candidates.filter((c) => !c.providerGroupId);
  const withGroup = candidates.filter((c) => c.providerGroupId);

  if (withGroup.length === 0) {
    const t = withoutGroup[0];
    return toMatchedTemplate(t);
  }

  const listCandidates = withGroup.filter((c) => {
    const pg = cached!.providerGroups.get(c.providerGroupId!);
    return pg?.matchMode === "list";
  });
  const othersCandidates = withGroup.filter((c) => {
    const pg = cached!.providerGroups.get(c.providerGroupId!);
    return pg?.matchMode === "others";
  });

  for (const t of listCandidates) {
    const pg = cached.providerGroups.get(t.providerGroupId!);
    if (!pg) continue;
    const fieldValue = itemData[pg.providerFieldName];
    if (!fieldValue) continue;
    if (fuzzyMatchProvider(fieldValue, pg.normalizedMembers)) {
      return toMatchedTemplate(t);
    }
  }

  if (othersCandidates.length > 0) {
    return toMatchedTemplate(othersCandidates[0]);
  }

  if (withoutGroup.length > 0) {
    return toMatchedTemplate(withoutGroup[0]);
  }

  return null;
}

function toMatchedTemplate(t: CachedTemplateEntry): MatchedTemplate {
  return {
    id: t.id,
    name: t.name,
    fields: t.fields,
    requiredDocuments: t.requiredDocuments ?? [],
    businessRules: t.businessRules ?? [],
  };
}

/**
 * Filter page/pdf fields by template for structured comparison.
 * Portal page fields are passed through UNFILTERED so business rules
 * can reference any field, not just mapped ones.
 * PDF fields are passed through UNFILTERED — AI-extracted labels vary
 * too much for substring matching (e.g. "Invoice Date" vs "Bill Date").
 * Prompt size is controlled via compact JSON formatting instead.
 */
export function filterFieldsByTemplate(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  _templateFields: TemplateField[]
): { filteredPageFields: Record<string, string>; filteredPdfFields: Record<string, string> } {
  return { filteredPageFields: pageFields, filteredPdfFields: pdfFields };
}

/**
 * Filter AI-returned fieldComparisons to only include fields configured in the template.
 * LLMs may return extra comparisons beyond what was requested — this enforces the template.
 * Matches by checking if the AI's fieldName starts with or equals a configured portalFieldName.
 */
export function filterComparisonsByTemplate(
  fieldComparisons: FieldComparison[],
  templateFields: TemplateField[]
): FieldComparison[] {
  if (templateFields.length === 0) return fieldComparisons;

  const allowedNames = templateFields.map((f) => f.portalFieldName.toLowerCase().trim());

  return fieldComparisons.filter((fc) => {
    const name = fc.fieldName.toLowerCase().trim();
    return allowedNames.some(
      (allowed) => name === allowed || name.startsWith(allowed + " /") || name.startsWith(allowed + "/")
    );
  });
}
