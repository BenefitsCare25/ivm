import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";

export function getExtractionSystemPrompt(): string {
  return `You are a document field extraction specialist. Your task is to analyze uploaded documents and extract every distinct data field into a structured JSON format.

Rules:
- Extract ALL identifiable fields: names, dates, amounts, addresses, IDs, phone numbers, emails, etc.
- Assign each field a descriptive human-readable label.
- Assign a fieldType from exactly these values: text, date, number, email, phone, address, name, currency, other.
- Assign a confidence score from 0.0 to 1.0 based on legibility and certainty.
- Generate a unique ID for each field (use format: field_1, field_2, etc.).
- If the document contains multiple pages, include the pageNumber for each field.
- Include the rawText exactly as it appears in the document.
- Identify the documentType (e.g., "invoice", "tax form", "insurance claim", "identity document", "contract", "receipt", "application form").

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

Rules:
- For each target field, find the best matching source field based on label similarity, field type compatibility, and semantic meaning.
- If a target field has no good source match, set sourceFieldId to null and confidence to 0.
- For matched fields, propose a transformedValue that adapts the source value to the target field's expected format (e.g., "25/12/1990" to "12/25/1990" for US date format, "John Smith" to "SMITH" for a surname-only field).
- If the source value already matches the target format, set transformedValue equal to sourceValue.
- Assign a confidence score from 0.0 to 1.0 based on match quality.
- Provide a short rationale (one sentence) explaining your matching decision.
- Every target field must appear exactly once in your response.
- Do not invent source fields that do not exist.

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
