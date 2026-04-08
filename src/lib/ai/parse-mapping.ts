import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";
import { stripMarkdownFences } from "./parse";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "ai-parse-mapping" });

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
  let matchedCount = 0;

  for (const entry of parsed as Record<string, unknown>[]) {
    const targetFieldId = entry.targetFieldId as string | undefined;
    if (!targetFieldId || !targetById.has(targetFieldId)) {
      log.warn({ targetFieldId, sourceFieldId: entry.sourceFieldId }, "Dropped mapping: invalid or unknown targetFieldId");
      continue;
    }

    const targetField = targetById.get(targetFieldId)!;
    mappedTargetIds.add(targetFieldId);

    let sourceFieldId = (entry.sourceFieldId as string | null) ?? null;
    let sourceField: ExtractedField | undefined;

    if (sourceFieldId !== null) {
      sourceField = sourceById.get(sourceFieldId);
      if (!sourceField) {
        log.warn({ sourceFieldId, targetFieldId }, "Source field not found, setting sourceFieldId to null");
        sourceFieldId = null;
      }
    }

    const confidence =
      typeof entry.confidence === "number"
        ? Math.min(1, Math.max(0, entry.confidence))
        : 0;

    const transformedValue = entry.transformedValue ? String(entry.transformedValue) : (sourceField?.value ?? "");

    if (targetField.options?.length && transformedValue) {
      const matches = targetField.options.some(
        (opt) => opt.trim() === transformedValue.trim()
      );
      if (!matches) {
        log.warn(
          { targetFieldId, transformedValue, availableOptions: targetField.options },
          "transformedValue not in target options — user should review"
        );
      }
    }

    if (sourceFieldId !== null) matchedCount++;

    mappings.push({
      id: crypto.randomUUID(),
      sourceFieldId,
      targetFieldId,
      sourceLabel: sourceField?.label ?? "",
      targetLabel: targetField.label,
      sourceValue: sourceField?.value ?? "",
      transformedValue,
      confidence,
      rationale: entry.rationale ? String(entry.rationale) : "",
      userApproved: sourceFieldId !== null,
    });
  }

  const unmatchedCount = targetFields.length - mappedTargetIds.size;

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

  log.info(
    { totalMappings: mappings.length, matchedCount, unmatchedCount },
    "Mapping parsed"
  );

  return mappings;
}
