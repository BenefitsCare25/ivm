import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";
import { stripMarkdownFences } from "./parse";

export function parseMappingResponse(
  rawText: string,
  extractedFields: ExtractedField[],
  targetFields: TargetField[]
): FieldMapping[] {
  const parsed = JSON.parse(stripMarkdownFences(rawText));

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid mapping response structure: expected an array");
  }

  const sourceById = new Map<string, ExtractedField>(
    extractedFields.map((f) => [f.id, f])
  );
  const targetById = new Map<string, TargetField>(
    targetFields.map((f) => [f.id, f])
  );

  const mappedTargetIds = new Set<string>();
  const mappings: FieldMapping[] = [];

  for (const entry of parsed as Record<string, unknown>[]) {
    const targetFieldId = entry.targetFieldId as string | undefined;
    if (!targetFieldId || !targetById.has(targetFieldId)) continue;

    const targetField = targetById.get(targetFieldId)!;
    mappedTargetIds.add(targetFieldId);

    let sourceFieldId = (entry.sourceFieldId as string | null) ?? null;
    let sourceField: ExtractedField | undefined;

    if (sourceFieldId !== null) {
      sourceField = sourceById.get(sourceFieldId);
      if (!sourceField) {
        sourceFieldId = null;
      }
    }

    const confidence =
      typeof entry.confidence === "number"
        ? Math.min(1, Math.max(0, entry.confidence))
        : 0;

    mappings.push({
      id: crypto.randomUUID(),
      sourceFieldId,
      targetFieldId,
      sourceLabel: sourceField?.label ?? "",
      targetLabel: targetField.label,
      sourceValue: sourceField?.value ?? "",
      transformedValue: entry.transformedValue ? String(entry.transformedValue) : (sourceField?.value ?? ""),
      confidence,
      rationale: entry.rationale ? String(entry.rationale) : "",
      userApproved: false,
    });
  }

  for (const targetField of targetFields) {
    if (mappedTargetIds.has(targetField.id)) continue;

    mappings.push({
      id: crypto.randomUUID(),
      sourceFieldId: null,
      targetFieldId: targetField.id,
      sourceLabel: "",
      targetLabel: targetField.label,
      sourceValue: "",
      transformedValue: "",
      confidence: 0,
      rationale: "No matching source field found",
      userApproved: false,
    });
  }

  return mappings;
}
