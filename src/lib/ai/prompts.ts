import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";

export function getExtractionSystemPrompt(knownDocumentTypes?: string[]): string {
  const docTypeInstruction = knownDocumentTypes && knownDocumentTypes.length > 0
    ? `Document type identification:
- You MUST use one of these exact names if the document matches: ${knownDocumentTypes.map((t) => `"${t}"`).join(", ")}
- Copy the name character-for-character — do not paraphrase, abbreviate, or translate
- If the document clearly does not match any listed type, describe it freely (e.g., "receipt", "contract", "unknown")`
    : `Document type identification:
- Identify the documentType (e.g., "invoice", "tax form", "insurance claim", "identity document", "contract", "receipt", "application form", "survey", "questionnaire")`;

  return `You are a document field extraction specialist. Your task is to analyze uploaded documents and extract every distinct data field into a structured JSON format.

COMPLETENESS IS CRITICAL:
- You MUST extract EVERY field on EVERY page. Do NOT stop early or summarize.
- If a document has 50 fields, return 50 fields. If it has 100, return 100.
- Process ALL pages sequentially. Include pageNumber for every field.
- Missing fields is worse than including uncertain ones — when in doubt, include the field with a low confidence score.

Rules:
- Extract ALL identifiable fields: names, dates, amounts, addresses, IDs, phone numbers, emails, etc.
- Assign each field a descriptive human-readable label.
- Assign a fieldType from exactly these values: text, date, number, email, phone, address, name, currency, other.
- Generate a unique ID for each field (use format: field_1, field_2, etc.).
- Include the rawText exactly as it appears in the document.
${docTypeInstruction}

Confidence scoring (assign differentiated scores, NOT the same score for every field):
- 0.95-1.0: Value is clearly legible, unambiguous, standard format.
- 0.80-0.94: Value is legible but has minor ambiguity (e.g., date could be MM/DD or DD/MM, handwriting is slightly unclear).
- 0.50-0.79: Value is partially illegible or inferred from surrounding context.
- 0.10-0.49: Value is mostly guessed due to poor legibility or missing parts.
- 0.0: Cannot determine value at all.

Survey/Form response rules (IMPORTANT):
- If the document is a filled-out survey, questionnaire, or form with rated/selected answers, extract each QUESTION as a field and its SELECTED ANSWER as the value.
- For a survey with N questions, you MUST return exactly N fields — one per question. Do not skip any question.
- For scale/rating questions (e.g., "1 = Rarely true", "2 = Sometimes true", "3 = Often true"), the value is the selected rating label (e.g., "2 = Sometimes true") and the label is the question/statement text.
- For checkbox or radio questions, the value is the selected option text.
- Do NOT extract question text as the value — extract what the respondent actually answered/selected.
- For grid/matrix questions where rows are statements and columns are rating options, extract each row as a separate field with its selected column value.

Example output for a survey:
{
  "documentType": "survey",
  "fields": [
    { "id": "field_1", "label": "I enjoy learning new things", "value": "4 = Often true", "fieldType": "text", "confidence": 0.95, "pageNumber": 1, "rawText": "I enjoy learning new things [4]" },
    { "id": "field_2", "label": "I exercise regularly", "value": "2 = Sometimes true", "fieldType": "text", "confidence": 0.90, "pageNumber": 1, "rawText": "I exercise regularly [2]" }
  ]
}

Example output for an invoice:
{
  "documentType": "invoice",
  "fields": [
    { "id": "field_1", "label": "Invoice Number", "value": "INV-2024-0042", "fieldType": "text", "confidence": 1.0, "pageNumber": 1, "rawText": "Invoice #: INV-2024-0042" },
    { "id": "field_2", "label": "Invoice Date", "value": "2024-03-15", "fieldType": "date", "confidence": 0.95, "pageNumber": 1, "rawText": "Date: 15/03/2024" },
    { "id": "field_3", "label": "Total Amount", "value": "1250.00", "fieldType": "currency", "confidence": 0.85, "pageNumber": 1, "rawText": "Total: $1,250.00" }
  ]
}

Return ONLY a JSON object with this exact structure (no markdown, no code fences, no explanation):
{
  "documentType": "string describing the document type",
  "fields": [
    {
      "id": "field_1",
      "label": "Human-readable field name",
      "value": "The extracted value",
      "fieldType": "text",
      "confidence": 0.95,
      "pageNumber": 1,
      "rawText": "Original text as it appears"
    }
  ]
}`;
}

export function getExtractionUserPrompt(fileName: string): string {
  return `Extract all data fields from this document: "${fileName}". Return the JSON response as specified.`;
}

export function getTextExtractionUserPrompt(fileName: string, textContent: string): string {
  return `Extract all data fields from this document: "${fileName}".

Document text content:
---
${textContent}
---

Return the JSON response as specified.`;
}

export function getMappingSystemPrompt(): string {
  return `You are a field-mapping specialist. Your task is to match extracted source document fields to target form fields and propose value transformations.

RULE 1 — OPTIONS CONSTRAINT (HIGHEST PRIORITY):
When a target field has an "options" array, transformedValue MUST be one of those EXACT option strings. No approximations.
- For scale ratings like "2 = Sometimes true", if target options are ["1","2","3","4"] use just "2". If options are ["1 = Rarely true","2 = Sometimes true",...] use the full matching label.
- If no source value matches any option, set sourceFieldId to null.

RULE 2 — MATCHING PRIORITY:
Match fields in this priority order:
1. Semantic meaning: What the field represents (e.g., "DOB" matches "Date of Birth", a question about "prayer" matches a section about "Relationship with God").
2. Label similarity: Text overlap between source and target labels.
3. Field type compatibility: Compatible types (e.g., text→text, date→date).
Semantic meaning overrides label text — a field about the same concept should match even if labels differ significantly.

RULE 3 — COMPOSITE FIELDS:
- If a source field contains combined data (e.g., "John Smith"), split it for separate firstName/lastName targets.
- If multiple source fields map to one target, concatenate them with appropriate formatting.

RULE 4 — TRANSFORMATIONS:
- Adapt values to the target's expected format: dates to target locale, names to target case convention.
- For scale ratings, extract just the numeric part if the target expects numbers, or the full label if target expects text.
- If the source value already matches the target format, set transformedValue equal to sourceValue.

RULE 5 — GENERAL:
- If a target field has no good source match, set sourceFieldId to null and confidence to 0.
- Assign a confidence score from 0.0 to 1.0 (0.9+ for strong semantic match, 0.7-0.89 for partial match, below 0.7 for weak/uncertain).
- Provide a short rationale explaining WHY you matched (or didn't match) — mention the semantic connection, not just "label similarity".
- Every target field must appear exactly once in your response.
- Do not invent source fields that do not exist.

Example mappings:
[
  { "sourceFieldId": "field_1", "targetFieldId": "t1", "sourceLabel": "Date of Birth", "targetLabel": "DOB", "sourceValue": "15/03/1990", "transformedValue": "03/15/1990", "confidence": 0.95, "rationale": "Same concept (birth date), reformatted from DD/MM to MM/DD" },
  { "sourceFieldId": "field_2", "targetFieldId": "t2", "sourceLabel": "I exercise regularly", "targetLabel": "Health habits question", "sourceValue": "3 = Often true", "transformedValue": "3", "confidence": 0.90, "rationale": "Semantic match on health/exercise topic; extracted numeric rating for target options [1,2,3,4]" },
  { "sourceFieldId": null, "targetFieldId": "t3", "sourceLabel": "", "targetLabel": "Emergency Contact", "sourceValue": "", "transformedValue": "", "confidence": 0, "rationale": "No source field contains emergency contact information" }
]

Return ONLY a JSON array (no markdown, no code fences, no explanation):
[
  {
    "sourceFieldId": "field_1" or null,
    "targetFieldId": "target_field_id",
    "sourceLabel": "Source Field Label",
    "targetLabel": "Target Field Label",
    "sourceValue": "extracted value" or "",
    "transformedValue": "value adapted for target" or "",
    "confidence": 0.95,
    "rationale": "Brief explanation of why this match was chosen"
  }
]`;
}

export function getMappingUserPrompt(
  extractedFields: ExtractedField[],
  targetFields: TargetField[]
): string {
  const sourceData = extractedFields.map((f) => ({
    id: f.id,
    label: f.label,
    value: f.value,
    fieldType: f.fieldType,
  }));

  const targetData = targetFields.map((f) => ({
    id: f.id,
    name: f.name,
    label: f.label,
    fieldType: f.fieldType,
    required: f.required,
    options: f.options,
  }));

  return `Source fields (extracted from document):
${JSON.stringify(sourceData, null, 2)}

Target fields (form to fill):
${JSON.stringify(targetData, null, 2)}

Map each target field to the best matching source field. Return the JSON array as specified.`;
}
