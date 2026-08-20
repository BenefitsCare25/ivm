import type { FieldComparison, MatchMode, TemplateField } from "@/types/portal";

export interface GroupedTemplateField {
  portalFieldName: string;
  documentFieldNames: string[];
  mode: MatchMode;
  tolerance?: number;
  verifyWithVision?: boolean;
}

const STATUS_PRIORITY: Record<FieldComparison["status"], number> = {
  MATCH: 5,
  MISMATCH: 4,
  UNCERTAIN: 3,
  MISSING_IN_PDF: 2,
  MISSING_ON_PAGE: 1,
};

const AMOUNT_LABEL_RE = /\b(amount|total|balance|payable|charge|receipt|paid|fee|cost|price|gst|subsid)/i;

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeExactValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Treat repeated portal-field mappings as alternative document labels. This
 * keeps legacy templates valid while ensuring the model is asked for one
 * result per portal field.
 */
export function groupTemplateFields(fields: TemplateField[]): GroupedTemplateField[] {
  const grouped = new Map<string, GroupedTemplateField>();

  for (const field of fields) {
    const key = normalizeName(field.portalFieldName);
    const documentNames = [field.documentFieldName, ...(field.documentFieldAliases ?? [])];
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        portalFieldName: field.portalFieldName,
        documentFieldNames: uniqueNames(documentNames),
        mode: field.mode,
        tolerance: field.tolerance,
        verifyWithVision: field.verifyWithVision,
      });
      continue;
    }

    existing.documentFieldNames = uniqueNames([...existing.documentFieldNames, ...documentNames]);
    existing.verifyWithVision = existing.verifyWithVision || field.verifyWithVision;
    if (existing.tolerance == null && field.tolerance != null) existing.tolerance = field.tolerance;
  }

  return [...grouped.values()];
}

/** Shared template-field matching for filtering, reconciliation, and vision. */
export function fieldNameMatchesPortal(comparisonFieldName: string, portalFieldName: string): boolean {
  const name = normalizeName(comparisonFieldName);
  const allowed = normalizeName(portalFieldName);
  return name === allowed || name.startsWith(allowed + " /") || name.startsWith(allowed + "/");
}

function findCanonicalField(
  comparisonFieldName: string,
  fields: GroupedTemplateField[]
): GroupedTemplateField | undefined {
  return fields.find((field) => fieldNameMatchesPortal(comparisonFieldName, field.portalFieldName));
}

function numericCandidates(value: string): number[] {
  return [...value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter(Number.isFinite);
}

function findDeterministicDocumentMatch(
  pageValue: string,
  field: GroupedTemplateField,
  pdfFields: Record<string, string>
): { label: string; value: string } | null {
  if (field.mode === "numeric") {
    const target = numericCandidates(pageValue)[0];
    if (target == null) return null;
    const tolerance = field.tolerance ?? 0;

    for (const [label, value] of Object.entries(pdfFields)) {
      if (!AMOUNT_LABEL_RE.test(label)) continue;
      if (numericCandidates(value).some((candidate) => Math.abs(candidate - target) <= tolerance)) {
        return { label, value };
      }
    }
    return null;
  }

  if (field.mode === "exact") {
    const target = normalizeExactValue(pageValue);
    if (!target) return null;
    for (const [label, value] of Object.entries(pdfFields)) {
      if (normalizeExactValue(value) === target) return { label, value };
    }
  }

  return null;
}

function mergeLineMatches(rows: FieldComparison[]): NonNullable<FieldComparison["documentLineMatches"]> {
  const seen = new Set<string>();
  const merged: NonNullable<FieldComparison["documentLineMatches"]> = [];
  for (const row of rows) {
    for (const match of row.documentLineMatches ?? []) {
      const key = `${normalizeName(match.label)}\u0000${match.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(match);
    }
  }
  return merged;
}

/**
 * Enforce one comparison per configured portal field and recover exact/numeric
 * matches from differently-labelled PDF fields before escalating to vision.
 */
export function reconcileFieldComparisons(
  comparisons: FieldComparison[],
  templateFields: TemplateField[],
  pdfFields: Record<string, string> = {}
): FieldComparison[] {
  const groupedFields = groupTemplateFields(templateFields);
  const rowsByPortalField = new Map<string, FieldComparison[]>();

  for (const comparison of comparisons) {
    const field = findCanonicalField(comparison.fieldName, groupedFields);
    if (!field) continue;
    const key = normalizeName(field.portalFieldName);
    const rows = rowsByPortalField.get(key) ?? [];
    rows.push(comparison);
    rowsByPortalField.set(key, rows);
  }

  const reconciled: FieldComparison[] = [];
  for (const field of groupedFields) {
    const rows = rowsByPortalField.get(normalizeName(field.portalFieldName));
    if (!rows?.length) continue;

    const sorted = [...rows].sort((a, b) =>
      STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status] ||
      Number(b.pdfValue != null) - Number(a.pdfValue != null) ||
      b.confidence - a.confidence
    );
    const selected: FieldComparison = { ...sorted[0], fieldName: field.portalFieldName };
    const lineMatches = mergeLineMatches(rows);
    if (lineMatches.length > 0) selected.documentLineMatches = lineMatches;
    if (selected.status === "MATCH" && selected.pdfValue == null && lineMatches[0]) {
      selected.pdfValue = lineMatches[0].value;
    }

    if (
      selected.pageValue != null &&
      (selected.status === "MISSING_IN_PDF" || selected.status === "UNCERTAIN")
    ) {
      const deterministicMatch = findDeterministicDocumentMatch(selected.pageValue, field, pdfFields);
      if (deterministicMatch) {
        selected.status = "MATCH";
        selected.pdfValue = deterministicMatch.value;
        selected.confidence = Math.max(selected.confidence, 0.99);
        selected.documentLineMatches = [
          ...(selected.documentLineMatches ?? []),
          deterministicMatch,
        ];
        selected.notes = [
          selected.notes,
          `Matched deterministically against document field "${deterministicMatch.label}".`,
        ].filter(Boolean).join(" ");
      }
    }

    reconciled.push(selected);
  }

  return reconciled;
}
