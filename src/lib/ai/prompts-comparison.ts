import type { TemplateField } from "@/types/portal";

export function getComparisonSystemPrompt(): string {
  return `You are an expert data comparison analyst. Your job is to compare structured data from a web portal page against data extracted from PDF/document files to identify matches, mismatches, and missing data.

You will receive:
1. "pageFields" — key-value pairs scraped from a web portal detail page
2. "pdfFields" — fields extracted from downloaded PDF/document files associated with this record

You must return a JSON object with this exact structure:
{
  "fieldComparisons": [
    {
      "fieldName": "Human-readable field name",
      "pageValue": "Value from the portal page (or null if not found)",
      "pdfValue": "Value from the PDF (or null if not found)",
      "status": "MATCH" | "MISMATCH" | "MISSING_IN_PDF" | "MISSING_ON_PAGE" | "UNCERTAIN",
      "confidence": 0.0 to 1.0,
      "notes": "Optional explanation of the comparison result"
    }
  ],
  "summary": "Brief narrative summary of the comparison results — highlight key discrepancies"
}

COMPARISON RULES:
1. MATCH: Values are semantically equivalent, even if formatted differently. Ignore formatting differences such as date formats, currency symbols, whitespace, and punctuation. For invoice numbers, reference numbers, and IDs, ignore leading punctuation characters (e.g. "#").
   For organization names (providers, clinics, hospitals): apply semantic parent-brand matching. If one name is plausibly a branch, division, or location variant of the same organization as the other — inferred from shared root brand words — treat as MATCH. Only mark MISMATCH if the two names clearly refer to entirely different organizations with no shared brand identity.
   For fields containing MULTIPLE identifiers joined by "&", "/", ",", or similar delimiters (e.g. "2026800011 & PS00126000689-1"): split into individual values and check whether each one appears in ANY document field (including Case Number, Invoice Number, Reference Number, etc.). If ALL individual values are found somewhere in the document fields, treat as MATCH. If only some are found, treat as UNCERTAIN with a note explaining which were found and which were not.
2. MISMATCH: Values differ in meaning or amount with no plausible semantic equivalence. Numeric values that differ in magnitude are always MISMATCH regardless of formatting.
3. MISSING_IN_PDF: The field exists on the portal page but has no corresponding value in the PDF data.
4. MISSING_ON_PAGE: The field exists in the PDF but has no corresponding field on the portal page.
5. UNCERTAIN: You cannot determine with reasonable confidence whether values match (e.g., abbreviation vs full name that could be different entity).
6. Compare ALL fields from both sources — do not skip any.
7. Match fields by semantic meaning, not exact label match. "Incurred Date" and "Date of Service" likely refer to the same thing.
8. For monetary amounts, compare numerical values regardless of currency symbols or formatting.
9. For dates, compare the actual date regardless of format.
10. Confidence: 0.95+ for clear match/mismatch, 0.7-0.94 for high-probability comparison, below 0.7 for uncertain.

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.`;
}

export function getTemplatedComparisonUserPrompt(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>,
  templateFields: TemplateField[]
): string {
  const rules = templateFields.map((f) => {
    // Support both old fieldName and new portalFieldName/documentFieldName
    const portalName = f.portalFieldName ?? (f as unknown as Record<string, string>).fieldName ?? "";
    const docName = f.documentFieldName ?? portalName;
    if (f.mode === "exact") return `- Portal "${portalName}" ↔ Document "${docName}": EXACT match required — any difference is MISMATCH`;
    if (f.mode === "numeric") {
      const tol = f.tolerance ?? 0;
      return `- Portal "${portalName}" ↔ Document "${docName}": NUMERIC comparison — values within ${tol} tolerance are MATCH`;
    }
    return `- Portal "${portalName}" ↔ Document "${docName}": FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols, leading punctuation on reference numbers). For organization names, apply semantic parent-brand matching: treat as MATCH if the names share the same root brand and one is plausibly a branch or variant of the other. For fields containing multiple identifiers joined by "&", "/", or "," — split them and check each against ALL document fields; treat as MATCH only if every individual value is found somewhere in the documents.`;
  }).join("\n");

  return `Compare the following data from a web portal page against data extracted from associated PDF documents.

IMPORTANT: Only compare the fields listed below. Ignore all other fields.

## Matching Rules
${rules}

## Portal Page Fields
${JSON.stringify(pageFields, null, 2)}

## PDF Extracted Fields
${JSON.stringify(pdfFields, null, 2)}

Return the JSON comparison result. Only include the fields specified in the matching rules above.`;
}

export function getComparisonUserPrompt(
  pageFields: Record<string, string>,
  pdfFields: Record<string, string>
): string {
  return `Compare the following data from a web portal page against data extracted from associated PDF documents.

## Portal Page Fields
${JSON.stringify(pageFields, null, 2)}

## PDF Extracted Fields
${JSON.stringify(pdfFields, null, 2)}

Return the JSON comparison result.`;
}
