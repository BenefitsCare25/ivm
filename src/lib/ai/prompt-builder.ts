import type { TemplateField, RequiredDocument, BusinessRule } from "@/types/portal";
import { BUSINESS_RULE_SEVERITY_LABELS } from "@/types/portal";
import { DIAGNOSIS_JSON_SCHEMA, DIAGNOSIS_RULES } from "./prompts-comparison";

const MAX_VALUE_LENGTH = 200;

function compactFields(fields: Record<string, string>): string {
  let needsTruncation = false;
  for (const v of Object.values(fields)) {
    if (v.length > MAX_VALUE_LENGTH) { needsTruncation = true; break; }
  }
  if (!needsTruncation) return JSON.stringify(fields);
  const truncated: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    truncated[k] = v.length > MAX_VALUE_LENGTH ? v.slice(0, MAX_VALUE_LENGTH) + "…" : v;
  }
  return JSON.stringify(truncated);
}

interface FullPromptConfig {
  fields: TemplateField[];
  businessRules: BusinessRule[];
  requiredDocuments: RequiredDocument[];
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  documentTypesFound: string[];
}

export function getFullComparisonSystemPrompt(): string {
  return `You are an expert data comparison and claims validation analyst. Your job is to:
1. Compare structured data from a web portal page against data extracted from PDF/document files
2. Evaluate business rules against all available data
3. Check if required documents are present

You will receive field mappings, business rules, required documents, and data from both sources.

Return ONLY valid JSON with this exact structure:
{
  "fieldComparisons": [
    {
      "fieldName": "Human-readable field name (use portal field name)",
      "pageValue": "Value from the portal page (or null if not found)",
      "pdfValue": "Value from the PDF (or null if not found)",
      "status": "MATCH" | "MISMATCH" | "MISSING_IN_PDF" | "MISSING_ON_PAGE" | "UNCERTAIN",
      "confidence": 0.0 to 1.0,
      "notes": "Optional explanation"
    }
  ],
  "businessRuleResults": [
    {
      "rule": "The exact rule text",
      "category": "The category",
      "status": "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE",
      "evidence": "Specific data from the documents supporting this result",
      "notes": "Optional explanation"
    }
  ],
  "requiredDocumentsCheck": [
    {
      "documentTypeName": "The document type name",
      "found": true or false,
      "notes": "Optional explanation"
    }
  ],
  ${DIAGNOSIS_JSON_SCHEMA},
  "summary": "Brief narrative summary — highlight key discrepancies and rule violations"
}

FIELD COMPARISON RULES:
1. MATCH: Values are semantically equivalent, even if formatted differently. "27 Mar 2026" and "2026-03-27" are MATCH. "$169.60" and "169.60" are MATCH.
2. MISMATCH: Values clearly differ in meaning or amount.
3. MISSING_IN_PDF: Field exists on portal but no corresponding value in PDF data.
4. MISSING_ON_PAGE: Field exists in PDF but no corresponding field on portal.
5. UNCERTAIN: Cannot determine with reasonable confidence.
6. ONLY compare the explicit field pairs provided in the Field Mappings section. Do NOT add extra field comparisons beyond those pairs.
7. For monetary amounts, compare numerical values regardless of currency symbols.
8. For dates, compare actual date regardless of format.
9. Confidence: 0.95+ for clear match/mismatch, 0.7-0.94 for probable, below 0.7 for uncertain.

BUSINESS RULE EVALUATION:
1. Evaluate each rule against ALL available data (portal fields, PDF fields, document types).
2. PASS: The condition is satisfied.
3. FAIL: The condition is violated — provide specific evidence.
4. WARNING: The condition may be violated but evidence is ambiguous.
5. NOT_APPLICABLE: The rule does not apply to this data (e.g., "check CPF deduction" when there is no CPF deduction).
6. Always provide evidence — cite specific values from the data.

REQUIRED DOCUMENTS CHECK:
1. Check if each required document type appears in the "Documents found" list.
2. For "one_of" groups, at least one document in the group must be present.
3. Use semantic matching — "Tax Invoice" matches "Invoice", "Medical Receipt" matches "Receipt".

${DIAGNOSIS_RULES}

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.`;
}

export function buildFullComparisonUserPrompt(config: FullPromptConfig): string {
  const { fields, businessRules, requiredDocuments, pageFields, pdfFields, documentTypesFound } = config;

  const fieldMappingLines = fields.map((f) => {
    const modeDesc =
      f.mode === "exact"
        ? "EXACT match required — any difference is MISMATCH"
        : f.mode === "numeric"
          ? `NUMERIC comparison — values within ${f.tolerance ?? 0} tolerance are MATCH`
          : "FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols)";
    return `- Portal "${f.portalFieldName}" ↔ Document "${f.documentFieldName}" — ${modeDesc}`;
  });

  const ruleLines = businessRules.map(
    (r, i) => `${i + 1}. [${BUSINESS_RULE_SEVERITY_LABELS[r.severity]}] ${r.rule}`
  );

  const requiredDocLines = requiredDocuments.map((rd) => {
    if (rd.rule === "one_of" && rd.group) {
      return `- "${rd.documentTypeName}" — ONE OF group "${rd.group}" (at least one in this group must be present)`;
    }
    return `- "${rd.documentTypeName}" — REQUIRED`;
  });

  let prompt = `Compare the following portal claim record against submitted documents.\n`;

  if (fields.length > 0) {
    prompt += `\n## 1. Field Mappings (compare ONLY these pairs)\nIMPORTANT: Only compare the field pairs listed below. Do NOT compare any other fields — ignore all fields not listed here.\n${fieldMappingLines.join("\n")}\n`;
  }

  if (businessRules.length > 0) {
    prompt += `\n## 2. Business Rules (evaluate each against ALL available data)\n${ruleLines.join("\n")}\n`;
  }

  if (requiredDocuments.length > 0) {
    prompt += `\n## 3. Required Documents (check presence)\n${requiredDocLines.join("\n")}\nDocuments found: ${JSON.stringify(documentTypesFound)}\n`;
  }

  prompt += `\n## Portal Page Fields\n${JSON.stringify(pageFields)}\n`;
  prompt += `\n## PDF Extracted Fields\n${compactFields(pdfFields)}\n`;
  prompt += `\nReturn the JSON comparison result with fieldComparisons${businessRules.length > 0 ? ", businessRuleResults" : ""}${requiredDocuments.length > 0 ? ", requiredDocumentsCheck" : ""}, and summary.`;

  return prompt;
}

/**
 * Build a preview of the AI prompt with placeholder data markers.
 * Used by the frontend prompt preview card.
 */
export function buildPromptPreview(config: {
  fields: TemplateField[];
  businessRules: BusinessRule[];
  requiredDocuments: RequiredDocument[];
}): string {
  const preview = buildFullComparisonUserPrompt({
    ...config,
    pageFields: { "<<Portal fields will be injected at runtime>>": "" },
    pdfFields: { "<<PDF extracted fields will be injected at runtime>>": "" },
    documentTypesFound: ["<<Detected from uploaded files at runtime>>"],
  });

  return `${getFullComparisonSystemPrompt()}\n\n---\n\n${preview}`;
}
