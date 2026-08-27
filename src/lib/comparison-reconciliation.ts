import type { FieldComparison, MatchMode, TemplateField } from "@/types/portal";

export interface GroupedTemplateField {
  portalFieldName: string;
  documentFieldNames: string[];
  mode: MatchMode;
  tolerance?: number;
  verifyWithVision?: boolean;
}

export interface ReconciliationDocumentContext {
  /** Extracted field label to original file name. */
  fieldSources?: Record<string, string>;
  /** Files confidently recognised as invoices, bills, or receipts. */
  billingFiles?: string[];
}

export interface CurrencyConversionEvidence {
  fieldLabel: string;
  origin: "document" | "portal";
  originalCurrency: string;
  originalAmount: number;
  sgdAmount: number;
  rate: number;
  rateDate: string;
  raw: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate persisted JSON before using it as deterministic comparison evidence. */
export function parseCurrencyConversionEvidence(value: unknown): CurrencyConversionEvidence | null {
  if (!isRecord(value)) return null;
  const origin = value.origin;
  const fieldLabel = typeof value.fieldLabel === "string" ? value.fieldLabel.trim() : "";
  const originalCurrency =
    typeof value.originalCurrency === "string" ? value.originalCurrency.trim().toUpperCase() : "";
  const rateDate = typeof value.rateDate === "string" ? value.rateDate.trim() : "";
  const originalAmount = Number(value.originalAmount);
  const sgdAmount = Number(value.sgdAmount);
  const rate = Number(value.rate);

  if (
    (origin !== "document" && origin !== "portal") ||
    !fieldLabel ||
    !originalCurrency ||
    !rateDate ||
    !Number.isFinite(originalAmount) ||
    !Number.isFinite(sgdAmount) ||
    !Number.isFinite(rate)
  ) {
    return null;
  }

  return {
    fieldLabel,
    origin,
    originalCurrency,
    originalAmount,
    sgdAmount,
    rate,
    rateDate,
    raw: typeof value.raw === "string" && value.raw.trim()
      ? value.raw.trim()
      : `${originalCurrency} ${originalAmount.toFixed(2)}`,
  };
}

/** Add explicit SGD conversion evidence to the fields shown to the comparison model. */
export function withCurrencyConversionFields(
  pdfFields: Record<string, string>,
  conversions: CurrencyConversionEvidence[]
): Record<string, string> {
  if (conversions.length === 0) return pdfFields;
  const enriched = { ...pdfFields };
  for (const conversion of conversions) {
    if (conversion.origin !== "document") continue;
    enriched[`${conversion.fieldLabel} (converted to SGD)`] =
      `${conversion.originalCurrency} ${conversion.originalAmount.toFixed(2)} = SGD ${conversion.sgdAmount.toFixed(2)} ` +
      `(rate ${conversion.rate.toFixed(4)} on ${conversion.rateDate})`;
  }
  return enriched;
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

function hasDocumentValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

const EXPLICIT_CURRENCY_PATTERNS: Array<[string, RegExp]> = [
  ["SGD", /(?:\bSGD\b|S\$)/i],
  ["MYR", /(?:\bMYR\b|\bRM\b)/i],
  ["USD", /(?:\bUSD\b|US\$)/i],
  ["AUD", /(?:\bAUD\b|A\$)/i],
  ["EUR", /(?:\bEUR\b|\u20AC)/i],
  ["GBP", /(?:\bGBP\b|\u00A3)/i],
  ["PHP", /\bPHP\b/i],
  ["JPY", /(?:\bJPY\b|\u00A5)/i],
  ["CNY", /\bCNY\b/i],
  ["HKD", /(?:\bHKD\b|HK\$)/i],
];

function explicitCurrency(value: string): string | null {
  return EXPLICIT_CURRENCY_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

/**
 * A deterministic amount must contain one unambiguous number. Extraction fields
 * that contain a subtotal, GST and total are intentionally left to the model or
 * vision pass instead of letting the subset search choose a convenient number.
 */
function singleMonetaryAmount(value: string): number | null {
  const candidates = numericCandidates(value);
  return candidates.length === 1 ? candidates[0] : null;
}

function currenciesCompatible(left: string | null, right: string | null): boolean {
  return left == null || right == null || left === right;
}

type DocumentLineMatch = NonNullable<FieldComparison["documentLineMatches"]>[number];

interface DeterministicMultiMatch {
  pdfValue: string;
  lineMatches: DocumentLineMatch[];
  notes: string;
}

const IDENTIFIER_FIELD_RE = /\b(?:invoice|receipt|claim|case|bill|reference|ref|identifier|number|no)\b/i;
const COMPOSITE_IDENTIFIER_SEPARATOR_RE = /\s*(?:\/|&|,|;|\band\b)\s*/i;

function splitCompositeIdentifiers(value: string): string[] {
  const parts = value
    .split(COMPOSITE_IDENTIFIER_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.some((part) => normalizeExactValue(part).length < 4)) return [];
  return parts;
}

function findCompositeIdentifierMatch(
  pageValue: string,
  field: GroupedTemplateField,
  pdfFields: Record<string, string>,
  context: ReconciliationDocumentContext
): DeterministicMultiMatch | null {
  if (
    field.mode !== "exact" ||
    !IDENTIFIER_FIELD_RE.test([field.portalFieldName, ...field.documentFieldNames].join(" "))
  ) {
    return null;
  }
  const identifiers = splitCompositeIdentifiers(pageValue);
  if (identifiers.length < 2) return null;

  const entries = Object.entries(pdfFields);
  const matches: DocumentLineMatch[] = [];
  for (const identifier of identifiers) {
    const target = normalizeExactValue(identifier);
    const found = entries
      .map(([label, value]) => ({
        label,
        value,
        tokens: splitCompositeIdentifiers(value).length > 0
          ? splitCompositeIdentifiers(value)
          : [value.trim()],
      }))
      .find((entry) => entry.tokens.some((token) => normalizeExactValue(token) === target));
    if (!found) return null;
    const matchedToken = found.tokens.find((token) => normalizeExactValue(token) === target)!;
    const sourceFile = context.fieldSources?.[found.label];
    matches.push({ label: found.label, value: matchedToken, ...(sourceFile ? { sourceFile } : {}) });
  }

  return {
    pdfValue: matches.map((match) => match.value).join(" / "),
    lineMatches: matches,
    notes: "All portal identifiers were found across the submitted billing documents.",
  };
}

function baseDocumentLabel(label: string): string {
  return label
    .replace(/\s*\[Occurrence\s+\d+\]\s*$/i, "")
    .replace(/\s*\[Document\s+\d+\]\s*$/i, "")
    .trim();
}

function syntheticDocumentSource(label: string): string | null {
  const match = label.match(/\[Document\s+(\d+)\]/i);
  return match ? `document:${match[1]}` : null;
}

const AUTHORITATIVE_TOTAL_RE = /\b(?:grand\s+total|total\s+amount|net\s+amount|receipt\s+amount|amount\s+paid|total\s+hospital\s+charges?)\b/i;

function amountLabelScore(label: string, field: GroupedTemplateField): number {
  const normalized = normalizeName(baseDocumentLabel(label));
  let score = AUTHORITATIVE_TOTAL_RE.test(normalized) ? 4 : 0;
  for (const documentName of field.documentFieldNames) {
    const mapped = normalizeName(documentName);
    if (normalized === mapped) score = Math.max(score, 10);
    else if (normalized.includes(mapped) || mapped.includes(normalized)) score = Math.max(score, 8);
  }
  return score;
}

interface AmountEvidence {
  label: string;
  value: string;
  amount: number;
  source: string;
  sourceFile?: string;
  score: number;
  currency: string | null;
}

function findCombinedAmountMatch(
  pageValue: string,
  field: GroupedTemplateField,
  pdfFields: Record<string, string>,
  context: ReconciliationDocumentContext
): DeterministicMultiMatch | null {
  if (field.mode !== "numeric") return null;
  const target = singleMonetaryAmount(pageValue);
  if (target == null) return null;
  const targetCurrency = explicitCurrency(pageValue);
  const billingFiles = new Set(context.billingFiles ?? []);
  const bySource = new Map<string, AmountEvidence[]>();

  for (const [label, value] of Object.entries(pdfFields)) {
    if (/converted\s+to\s+sgd/i.test(label)) continue;
    const score = amountLabelScore(label, field);
    if (score < 4) continue;
    const sourceFile = context.fieldSources?.[label];
    const source = sourceFile ?? syntheticDocumentSource(label);
    if (!source || (billingFiles.size > 0 && !billingFiles.has(source))) continue;
    const amount = singleMonetaryAmount(value);
    if (amount == null) continue;
    const currency = explicitCurrency(value);
    if (!currenciesCompatible(targetCurrency, currency)) continue;
    const rows = bySource.get(source) ?? [];
    if (!rows.some((row) => Math.abs(row.amount - amount) < 0.0001)) {
      rows.push({ label, value, amount, source, sourceFile, score, currency });
      bySource.set(source, rows);
    }
  }

  const groups = [...bySource.values()]
    .filter((rows) => rows.length > 0)
    .map((rows) => rows.sort((a, b) => b.score - a.score).slice(0, 8));
  if (groups.length < 2) return null;

  const tolerance = field.tolerance ?? 0;
  let attempts = 0;
  let matched: AmountEvidence[] | null = null;
  const search = (groupIndex: number, selected: AmountEvidence[], sum: number): void => {
    if (matched || attempts >= 2048) return;
    if (groupIndex === groups.length) {
      attempts += 1;
      const knownCurrencies = new Set(selected.map((row) => row.currency).filter(Boolean));
      if (knownCurrencies.size <= 1 && Math.abs(sum - target) <= tolerance) matched = [...selected];
      return;
    }
    for (const candidate of groups[groupIndex]) {
      selected.push(candidate);
      search(groupIndex + 1, selected, sum + candidate.amount);
      selected.pop();
      if (matched) return;
    }
  };
  search(0, [], 0);
  if (!matched) return null;

  const evidence = matched as AmountEvidence[];
  return {
    pdfValue: evidence.map((row) => row.value).join(" + "),
    lineMatches: evidence.map((row) => ({
      label: row.label,
      value: row.value,
      ...(row.sourceFile ? { sourceFile: row.sourceFile } : {}),
    })),
    notes: `Summed ${evidence.length} billing-document amounts to ${target.toFixed(2)}.`,
  };
}

function findDeterministicDocumentMatch(
  pageValue: string,
  field: GroupedTemplateField,
  pdfFields: Record<string, string>
): { label: string; value: string } | null {
  if (field.mode === "numeric") {
    const target = singleMonetaryAmount(pageValue);
    if (target == null) return null;
    const targetCurrency = explicitCurrency(pageValue);
    const tolerance = field.tolerance ?? 0;

    for (const [label, value] of Object.entries(pdfFields)) {
      if (!AMOUNT_LABEL_RE.test(label)) continue;
      const candidate = singleMonetaryAmount(value);
      if (
        candidate != null &&
        currenciesCompatible(targetCurrency, explicitCurrency(value)) &&
        Math.abs(candidate - target) <= tolerance
      ) {
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
  pdfFields: Record<string, string> = {},
  documentContext: ReconciliationDocumentContext = {}
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
      Number(hasDocumentValue(b.pdfValue)) - Number(hasDocumentValue(a.pdfValue)) ||
      b.confidence - a.confidence
    );
    const selected: FieldComparison = { ...sorted[0], fieldName: field.portalFieldName };
    if (!hasDocumentValue(selected.pdfValue)) selected.pdfValue = null;
    const lineMatches = mergeLineMatches(rows);
    if (lineMatches.length > 0) selected.documentLineMatches = lineMatches;
    if (selected.status === "MATCH" && !hasDocumentValue(selected.pdfValue) && lineMatches[0]) {
      selected.pdfValue = lineMatches[0].value;
    }

    // A model-emitted MATCH is not valid without document evidence. Converting
    // it here makes the invariant true for every caller and allows the normal
    // deterministic/vision fallbacks below to recover it when possible.
    if (selected.status === "MATCH" && !hasDocumentValue(selected.pdfValue)) {
      selected.status = selected.pageValue?.trim() ? "MISSING_IN_PDF" : "UNCERTAIN";
      selected.confidence = Math.min(selected.confidence, 0.5);
      selected.notes = [
        selected.notes,
        "Model returned MATCH without a document value or supporting line evidence.",
      ].filter(Boolean).join(" ");
    }

    const multiDocumentMatch = selected.pageValue
      ? findCompositeIdentifierMatch(selected.pageValue, field, pdfFields, documentContext) ??
        (selected.status !== "MATCH"
          ? findCombinedAmountMatch(selected.pageValue, field, pdfFields, documentContext)
          : null)
      : null;
    if (multiDocumentMatch) {
      selected.status = "MATCH";
      selected.pdfValue = multiDocumentMatch.pdfValue;
      selected.confidence = Math.max(selected.confidence, 0.99);
      selected.documentLineMatches = multiDocumentMatch.lineMatches;
      selected.notes = [selected.notes, multiDocumentMatch.notes].filter(Boolean).join(" ");
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

function conversionScore(
  conversion: CurrencyConversionEvidence,
  field: GroupedTemplateField
): number {
  if (conversion.origin !== "document") return -1;
  const label = normalizeName(conversion.fieldLabel);
  let score = AMOUNT_LABEL_RE.test(label) ? 1 : 0;
  for (const documentName of field.documentFieldNames) {
    const mapped = normalizeName(documentName);
    if (label === mapped) score = Math.max(score, 4);
    else if (label.includes(mapped) || mapped.includes(label)) score = Math.max(score, 3);
  }
  return score;
}

/**
 * Populate a missing document amount from the currency-validation result that
 * already converted the billing document's foreign amount to SGD.
 */
export function applyCurrencyConversionEvidence(
  comparisons: FieldComparison[],
  templateFields: TemplateField[],
  conversions: CurrencyConversionEvidence[]
): FieldComparison[] {
  if (conversions.length === 0) return comparisons;
  const groupedFields = groupTemplateFields(templateFields);

  return comparisons.map((comparison) => {
    const field = findCanonicalField(comparison.fieldName, groupedFields);
    if (!field || field.mode !== "numeric" || !comparison.pageValue) return comparison;
    const visionOnlyMatch =
      comparison.status === "MATCH" &&
      comparison.visionVerification?.verdict === "CONFIRMED" &&
      hasDocumentValue(comparison.pdfValue) &&
      normalizeExactValue(comparison.pdfValue) === normalizeExactValue(comparison.pageValue);
    if (comparison.status === "MATCH" && hasDocumentValue(comparison.pdfValue) && !visionOnlyMatch) {
      return comparison;
    }

    const ranked = conversions
      .map((conversion) => ({ conversion, score: conversionScore(conversion, field) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score);
    const conversion = ranked[0]?.conversion;
    const portalAmount = numericCandidates(comparison.pageValue)[0];
    if (!conversion || portalAmount == null) return comparison;

    const tolerance = field.tolerance ?? 0;
    const difference = Math.abs(portalAmount - conversion.sgdAmount);
    const status = difference <= tolerance ? "MATCH" : "MISMATCH";
    const pdfValue = `${conversion.originalCurrency} ${conversion.originalAmount.toFixed(2)} (SGD ${conversion.sgdAmount.toFixed(2)})`;
    const lineMatch = { label: conversion.fieldLabel, value: conversion.raw };

    return {
      ...comparison,
      fieldName: field.portalFieldName,
      pdfValue,
      status,
      confidence: Math.max(comparison.confidence, 0.95),
      documentLineMatches: [
        ...(comparison.documentLineMatches ?? []).filter(
          (match) => normalizeName(match.label) !== normalizeName(lineMatch.label) || match.value !== lineMatch.value
        ),
        lineMatch,
      ],
      notes: [
        comparison.notes,
        `Compared against converted billing amount SGD ${conversion.sgdAmount.toFixed(2)} ` +
          `(rate ${conversion.rate.toFixed(4)} on ${conversion.rateDate}; difference SGD ${difference.toFixed(2)}).`,
      ].filter(Boolean).join(" "),
    };
  });
}
