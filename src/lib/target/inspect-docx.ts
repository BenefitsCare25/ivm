import mammoth from "mammoth";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";
import { formatFieldLabel } from "@/lib/utils";
import type { InspectResult } from "./inspect-webpage";

const PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;

const NAME_TYPE_HINTS: [string, TargetField["fieldType"]][] = [
  ["email", "email"],
  ["date", "date"],
  ["dob", "date"],
  ["birthday", "date"],
  ["phone", "number"],
  ["tel", "number"],
  ["amount", "number"],
  ["total", "number"],
  ["price", "number"],
  ["quantity", "number"],
  ["count", "number"],
  ["notes", "textarea"],
  ["description", "textarea"],
  ["comments", "textarea"],
  ["address", "textarea"],
];

export async function inspectDocx(buffer: Buffer): Promise<InspectResult> {
  let text: string;
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } catch {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: "Could not parse DOCX file",
    };
  }

  const seen = new Set<string>();
  const fields: TargetField[] = [];
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    const lowerName = raw.toLowerCase();
    const hint = NAME_TYPE_HINTS.find(([k]) => lowerName.includes(k));

    fields.push({
      id: randomUUID(),
      name: raw,
      label: formatFieldLabel(raw),
      fieldType: hint ? hint[1] : "text",
      required: false,
    });
  }

  return { fields, isSupported: true };
}
