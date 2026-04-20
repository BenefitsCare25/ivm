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

/** Extract outermost JSON object from free-form text that contains all requiredKeys. */
export function extractJsonObject(text: string, requiredKeys: string[]): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i += 2; continue; } // skip escaped character
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (requiredKeys.every((k) => candidate.includes(`"${k}"`))) {
            return candidate;
          }
        }
      }
    }
    i++;
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
    const extracted = extractJsonObject(rawText, ["documentType", "fields"]);
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
