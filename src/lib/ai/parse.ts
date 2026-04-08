import { FIELD_TYPES, type FieldType, type ExtractedField } from "@/types/extraction";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "ai-parse" });

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export function parseExtractionResponse(rawText: string): { documentType: string; fields: ExtractedField[] } {
  const cleaned = stripMarkdownFences(rawText);

  const parsed = JSON.parse(cleaned);

  if (!parsed.documentType || !Array.isArray(parsed.fields)) {
    throw new Error("Invalid extraction response structure: missing documentType or fields array");
  }

  const validFieldTypes = new Set<string>(FIELD_TYPES);

  const fields: ExtractedField[] = parsed.fields.map((f: Record<string, unknown>, index: number) => {
    const rawType = f.fieldType as string;
    if (rawType && !validFieldTypes.has(rawType)) {
      log.warn({ fieldIndex: index, rawType, label: f.label }, "Coerced unknown fieldType to 'other'");
    }
    if (typeof f.confidence !== "number") {
      log.warn({ fieldIndex: index, label: f.label }, "Missing confidence score, defaulting to 0");
    }
    return {
      id: (f.id as string) || `field_${index + 1}`,
      label: String(f.label || "Unknown"),
      value: String(f.value ?? ""),
      fieldType: validFieldTypes.has(rawType) ? (rawType as FieldType) : "other",
      confidence: typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 0,
      pageNumber: typeof f.pageNumber === "number" ? f.pageNumber : undefined,
      rawText: f.rawText ? String(f.rawText) : undefined,
    };
  });

  log.info({ fieldCount: fields.length, documentType: parsed.documentType }, "Extraction parsed");

  return { documentType: String(parsed.documentType), fields };
}
