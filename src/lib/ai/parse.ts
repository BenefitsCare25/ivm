import { FIELD_TYPES, type FieldType, type ExtractedField } from "@/types/extraction";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "ai-parse" });

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  // Strict: entire text is a single fenced block
  const strict = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (strict) return strict[1].trim();

  // Loose: fenced block anywhere in text (agent may add explanation around it)
  const loose = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (loose) return loose[1].trim();

  return trimmed;
}

/** Try to extract a JSON object containing documentType+fields from free-form text. */
function extractJsonFromText(text: string): string | null {
  // Find the outermost { ... } that contains "documentType"
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        if (candidate.includes('"documentType"') && candidate.includes('"fields"')) {
          return candidate;
        }
      }
    }
  }
  return null;
}

export function parseExtractionResponse(rawText: string): { documentType: string; fields: ExtractedField[] } {
  const cleaned = stripMarkdownFences(rawText);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Agent responses often wrap JSON in conversational text — extract it
    const extracted = extractJsonFromText(rawText);
    if (!extracted) {
      log.error({ rawLength: rawText.length, first300: rawText.slice(0, 300) }, "Cannot find JSON in response");
      throw new Error("Could not parse extraction response — no valid JSON found");
    }
    parsed = JSON.parse(extracted);
  }

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
