import { jsonrepair } from "jsonrepair";
import { FIELD_TYPES, type FieldType, type ExtractedField } from "@/types/extraction";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "ai-parse" });

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const FENCE = "```";

  if (!trimmed.startsWith(FENCE)) return trimmed;

  // Find end of opening fence line (```json or ```)
  const openLineEnd = trimmed.indexOf("\n", FENCE.length);
  if (openLineEnd === -1) return trimmed;

  // Find the closing fence — use lastIndexOf to handle any ``` inside content
  const closeFenceStart = trimmed.lastIndexOf(FENCE);
  if (closeFenceStart <= openLineEnd) return trimmed;

  return trimmed.slice(openLineEnd + 1, closeFenceStart).trim();
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

type ParsedShape = { documentType?: unknown; fields?: unknown } & Record<string, unknown>;

function hasFieldsArray(v: unknown): v is ParsedShape {
  return !!v && typeof v === "object" && Array.isArray((v as ParsedShape).fields);
}

function tryJson(text: string): ParsedShape | null {
  try {
    const p = JSON.parse(text) as unknown;
    return hasFieldsArray(p) ? p : null;
  } catch {
    return null;
  }
}

function tryRepair(text: string): ParsedShape | null {
  try {
    return tryJson(jsonrepair(text));
  } catch {
    return null;
  }
}

/** Split a JSON-array body into its top-level {...} objects — brace-aware and
 * string-safe, so a value containing braces (e.g. "take {2} tablets") doesn't
 * prematurely close the object. A truncated final object is returned whole for
 * jsonrepair to close. */
function extractTopLevelObjects(slice: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, start = -1;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start !== -1) { out.push(slice.slice(start, i + 1)); start = -1; } }
  }
  if (depth > 0 && start !== -1) out.push(slice.slice(start)); // truncated tail
  return out;
}

/**
 * Last-resort salvage: even if the whole object is unparseable (truncated,
 * badly malformed), recover as many individual field objects as possible so a
 * document is never fully lost over one broken field. Field objects are flat
 * ({id,label,value,fieldType,confidence,pageNumber,rawText}), so a per-object
 * scan + repair works where whole-document repair fails.
 */
function salvageFields(rawText: string): ParsedShape | null {
  const dt = rawText.match(/"documentType"\s*:\s*"([^"]*)"/);
  const documentType = dt?.[1] ?? "unknown";

  const fieldsKey = rawText.indexOf('"fields"');
  const arrStart = fieldsKey === -1 ? rawText.indexOf("[") : rawText.indexOf("[", fieldsKey);
  if (arrStart === -1) return null;

  // Find the matching ] (or take the rest if the response was truncated).
  let depth = 0, inStr = false, end = -1;
  for (let i = arrStart; i < rawText.length; i++) {
    const c = rawText[i];
    if (inStr) { if (c === "\\") { i++; continue; } if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  const slice = end !== -1 ? rawText.slice(arrStart, end + 1) : rawText.slice(arrStart);

  // First try repairing the whole array (jsonrepair auto-closes truncated ones).
  const wholeArray = tryRepair(`{"fields":${slice}}`);
  if (wholeArray && wholeArray.fields && (wholeArray.fields as unknown[]).length > 0) {
    return { documentType, fields: wholeArray.fields };
  }

  // Otherwise recover field objects one by one (string-safe, brace-tolerant).
  const objs: unknown[] = [];
  for (const chunk of extractTopLevelObjects(slice)) {
    if (!chunk.includes('"label"')) continue;
    try { objs.push(JSON.parse(jsonrepair(chunk))); } catch { /* skip unrecoverable field */ }
  }
  return objs.length > 0 ? { documentType, fields: objs } : null;
}

export function parseExtractionResponse(rawText: string): { documentType: string; fields: ExtractedField[] } {
  const cleaned = stripMarkdownFences(rawText);
  const embedded = extractJsonObject(rawText, ["documentType", "fields"]);

  // Layered recovery — strictest first, most tolerant last. Smaller local models
  // occasionally emit invalid JSON (unquoted keys, trailing commas, truncation);
  // repair + salvage keep a document from being lost over a formatting slip.
  let parsed: ParsedShape | null =
    tryJson(cleaned) ??
    (embedded ? tryJson(embedded) : null);

  let recovered: string | null = null;
  if (!parsed) {
    parsed = tryRepair(cleaned) ?? (embedded ? tryRepair(embedded) : null) ?? tryRepair(rawText);
    if (parsed) recovered = "repair";
  }
  if (!parsed) {
    parsed = salvageFields(rawText);
    if (parsed) recovered = "salvage";
  }

  if (!parsed || !Array.isArray(parsed.fields)) {
    log.error({ rawLength: rawText.length, first300: rawText.slice(0, 300) }, "Cannot parse extraction response");
    throw new Error("Could not parse extraction response — no valid JSON found");
  }
  if (recovered) {
    log.warn({ via: recovered, fieldCount: (parsed.fields as unknown[]).length }, "Recovered extraction JSON");
  }

  const documentType = typeof parsed.documentType === "string" && parsed.documentType.trim()
    ? parsed.documentType
    : "unknown";

  const validFieldTypes = new Set<string>(FIELD_TYPES);

  const fields: ExtractedField[] = (parsed.fields as Record<string, unknown>[])
    .filter((f) => f && typeof f === "object")
    .map((f, index) => {
      const rawType = f.fieldType as string;
      if (rawType && !validFieldTypes.has(rawType)) {
        log.warn({ fieldIndex: index, rawType, label: f.label }, "Coerced unknown fieldType to 'other'");
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

  log.info({ fieldCount: fields.length, documentType }, "Extraction parsed");

  return { documentType: String(documentType), fields };
}
