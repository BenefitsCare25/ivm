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

/** One submitted file's recognized type + its extracted fields, for provenance. */
export interface DocumentGroup {
  fileName: string;
  /** Human-readable recognized type/family (e.g. "Hospital Bill / Tax Invoice", "Referral Letter"). */
  label: string;
  fields: Record<string, string>;
}

interface FullPromptConfig {
  fields: TemplateField[];
  businessRules: BusinessRule[];
  requiredDocuments: RequiredDocument[];
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  documentTypesFound: string[];
  /** Per-file grouping so the model knows which document each value came from. */
  documentGroups?: DocumentGroup[];
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
      "notes": "Optional explanation",
      "documentLineMatches": [ { "label": "Line item label as it appears in the document", "value": "Matching value as it appears in the document" } ]
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
8. For date fields: compare actual date regardless of format. For FUZZY-mode date fields only: if the mapped document field has a different date, scan ALL other date fields in the PDF Extracted Fields (e.g., Visit Date, Bill Date, Admission Date, Service Date, Hospitalisation Period dates). If the portal date matches ANY date value found anywhere in the document, return MATCH with documentLineMatches showing which field(s) matched. This fallback does NOT apply to EXACT or NUMERIC mode date fields — those must strictly compare only the mapped field pair.
9. Confidence: 0.95+ for clear match/mismatch, 0.7-0.94 for probable, below 0.7 for uncertain.
10. documentLineMatches (when status="MISMATCH" on a numeric/monetary field, OR when a FUZZY-mode date field returns MATCH via the fallback scan in rule 8):
    - Scan ALL PDF Extracted Fields for any line items whose value equals the portal value (ignore sign and formatting for numeric — e.g. portal "167.70" matches document line "-167.70" or "$167.70"; ignore date format differences for dates).
    - For each match, return an object { "label": <pdf field name>, "value": <pdf field value as it appears> }.
    - Include MULTIPLE entries if the portal value appears in multiple line items.
    - Omit the field entirely (or use an empty array) if the portal value does not appear anywhere else in the document.
    - Do NOT include the line that is already shown as pdfValue.
11. PROVIDER / FACILITY / BILL-AMOUNT SOURCING (critical): When comparing a provider, hospital, clinic, facility, or payee NAME — or a bill / claim / invoice AMOUNT — the authoritative source is the BILLING document (Tax Invoice, Final Bill, Summary Bill, Interim Bill, Hospital Statement, Statement of Account, or similar). Use the "Document Sources" section to see which file each value came from.
    - A Referral Letter, Memo, or referral note names the REFERRING doctor's clinic — NOT the treating facility. NEVER use a referral/memo letterhead as the Provider.
    - If a billing document is present, the Provider and bill amount MUST come from it. Ignore provider/company names that appear only on referral letters, discharge summaries, or other non-billing documents.
    - When the mapped document value is the wrong source (e.g. the provider came from a referral letter but a tax invoice with a different provider exists), compare the portal value against the BILLING document's value instead, and note which document you used.

BUSINESS RULE EVALUATION:
1. Evaluate each rule against ALL available data (portal fields, PDF fields, document types).
2. PASS: The condition is satisfied — the claim complies with the rule.
3. FAIL: The condition is violated — provide specific evidence.
4. WARNING: The condition may be violated but evidence is ambiguous.
5. NOT_APPLICABLE: The rule does not apply to this data (e.g., "check CPF deduction" when there is no CPF deduction).
6. Always provide evidence — cite specific values from the data.
7. EXCEPTION HANDLING: If a rule contains an exception or exemption clause (e.g., "required EXCEPT for X", "not needed for follow-up visits"), and the current claim satisfies the exception condition, return PASS — the claim is compliant because the exception applies. Do NOT return WARNING or FAIL just because an exception was triggered. Exceeding a requirement (e.g., submitting a referral letter even when not required for a follow-up) is not a violation.

REQUIRED DOCUMENTS CHECK:
1. Check if each required document type appears in the "Documents found" list OR is evident from the PDF Extracted Fields.
2. For "one_of" groups, at least one document in the group must be present.
3. Use GENEROUS semantic matching — recognise that hospitals title the same document many ways:
   - A "Summary Tax Invoice" / "Tax Invoice" requirement is satisfied by ANY hospital billing document: "Final Bill", "Summary Bill", "Interim Bill", "Discharge Invoice", "Hospital Statement", "Statement of Account", "Inpatient Bill", "Billing Summary", etc. An INTERIM/provisional bill still counts as the bill being present — do NOT mark the document missing just because it is not the final version.
   - "Medical Receipt" matches "Receipt"/"Official Receipt"; "Referral Letter" matches "Memo"/"Referral Note"; "Discharge Summary" matches "Medical Report"/"Clinical Summary".
4. Only return found:false when there is genuinely NO document of that family among the submitted files. When unsure, prefer found:true with a note explaining the ambiguity rather than a false "not found".

${DIAGNOSIS_RULES}

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.`;
}

export function buildFullComparisonUserPrompt(config: FullPromptConfig): string {
  const { fields, businessRules, requiredDocuments, pageFields, pdfFields, documentTypesFound, documentGroups } = config;

  // Code rules are evaluated deterministically in-process, not by the model.
  const aiRules = businessRules.filter((r) => r.type !== "code");

  const fieldMappingLines = fields.map((f) => {
    const modeDesc =
      f.mode === "exact"
        ? "EXACT match required — any difference is MISMATCH"
        : f.mode === "numeric"
          ? `NUMERIC comparison — values within ${f.tolerance ?? 0} tolerance are MATCH`
          : "FUZZY match — ignore formatting differences (dates, names, whitespace, currency symbols)";
    return `- Portal "${f.portalFieldName}" ↔ Document "${f.documentFieldName}" — ${modeDesc}`;
  });

  const ruleLines = aiRules.map(
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

  if (aiRules.length > 0) {
    prompt += `\n## 2. Business Rules (evaluate each against ALL available data)\n${ruleLines.join("\n")}\n`;
  }

  if (requiredDocuments.length > 0) {
    prompt += `\n## 3. Required Documents (check presence)\n${requiredDocLines.join("\n")}\nDocuments found: ${JSON.stringify(documentTypesFound)}\n`;
  }

  prompt += `\n## Portal Page Fields\n${JSON.stringify(pageFields)}\n`;
  prompt += `\n## PDF Extracted Fields\n${compactFields(pdfFields)}\n`;

  // Provenance only matters when there is more than one document — with a single
  // file every value came from it, so skip the extra tokens.
  if (documentGroups && documentGroups.length > 1) {
    const groupLines = documentGroups.map(
      (g) => `[${g.label}] ${g.fileName}: ${compactFields(g.fields)}`
    );
    prompt += `\n## Document Sources (provenance — which file each value came from)\nWhen the same field (e.g. Provider / hospital / clinic name, or a bill amount) appears in more than one document below, source it from the BILLING document (Tax Invoice / Final Bill / Hospital Statement) per rule 11 — never from a referral letter or memo.\n${groupLines.join("\n")}\n`;
  }
  prompt += `\nReturn the JSON comparison result with fieldComparisons${aiRules.length > 0 ? ", businessRuleResults" : ""}${requiredDocuments.length > 0 ? ", requiredDocumentsCheck" : ""}, and summary.`;

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
    documentGroups: [
      { fileName: "<<billing document>>", label: "Hospital Bill / Tax Invoice", fields: { Provider: "<<hospital name>>", "Bill Amount": "<<amount>>" } },
      { fileName: "<<referral letter>>", label: "Referral Letter", fields: { From: "<<referring clinic — NOT the provider>>" } },
    ],
  });

  return `${getFullComparisonSystemPrompt()}\n\n---\n\n${preview}`;
}
