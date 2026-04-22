import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { toInputJson } from "@/lib/utils";
import { ValidationStatus, Prisma } from "@prisma/client";

interface ItemRow {
  id: string;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
}

const DATE_FIELD_PATTERNS = [
  /date.*visit/i, /visit.*date/i,
  /admission.*date/i, /date.*admission/i,
  /service.*date/i, /date.*service/i,
  /incurred.*date/i, /date.*incurred/i,
  /treatment.*date/i, /date.*treatment/i,
  /consultation.*date/i,
];

const PATIENT_FIELD_PATTERNS = [
  /employee/i, /claimant/i, /patient/i,
  /member.*name/i, /name.*member/i,
  /employee.*name/i,
];

function findFieldByPatterns(
  data: Record<string, string>,
  patterns: RegExp[]
): { key: string; value: string } | null {
  for (const [key, value] of Object.entries(data)) {
    if (patterns.some((p) => p.test(key)) && value.trim()) {
      return { key, value: value.trim().toLowerCase() };
    }
  }
  return null;
}

function getMergedData(item: ItemRow): Record<string, string> {
  return { ...item.listData, ...(item.detailData ?? {}) };
}

export async function runCrossItemChecks(sessionId: string): Promise<number> {
  const items = await db.trackedItem.findMany({
    where: {
      scrapeSessionId: sessionId,
      status: { in: ["COMPARED", "FLAGGED"] },
    },
    select: {
      id: true,
      listData: true,
      detailData: true,
    },
  });

  if (items.length < 2) return 0;

  const typedItems: ItemRow[] = items.map((it) => ({
    id: it.id,
    listData: (it.listData ?? {}) as Record<string, string>,
    detailData: (it.detailData ?? null) as Record<string, string> | null,
  }));

  const firstData = getMergedData(typedItems[0]);
  const dateField = findFieldByPatterns(firstData, DATE_FIELD_PATTERNS);
  const patientField = findFieldByPatterns(firstData, PATIENT_FIELD_PATTERNS);

  if (!dateField) {
    logger.info({ sessionId }, "[cross-item] No date field detected, skipping duplicate check");
    return 0;
  }

  const groups = new Map<string, string[]>();
  for (const item of typedItems) {
    const data = getMergedData(item);
    const dateVal = data[dateField.key]?.trim().toLowerCase() ?? "";
    const patientVal = patientField ? (data[patientField.key]?.trim().toLowerCase() ?? "") : "";

    if (!dateVal) continue;

    const groupKey = patientField ? `${patientVal}|||${dateVal}` : dateVal;
    const existing = groups.get(groupKey) ?? [];
    existing.push(item.id);
    groups.set(groupKey, existing);
  }

  const allItemIds = typedItems.map((i) => i.id);
  const existingDups = await db.validationResult.findMany({
    where: { trackedItemId: { in: allItemIds }, ruleType: "DUPLICATE" },
    select: { trackedItemId: true },
  });
  const alreadyFlagged = new Set(existingDups.map((e) => e.trackedItemId));

  let duplicatesFound = 0;
  const inserts: Prisma.ValidationResultCreateManyInput[] = [];

  for (const [, itemIds] of groups) {
    if (itemIds.length < 2) continue;

    for (const itemId of itemIds) {
      if (alreadyFlagged.has(itemId)) continue;

      inserts.push({
        trackedItemId: itemId,
        ruleType: "DUPLICATE",
        status: ValidationStatus.WARNING,
        message: `Same-date visit detected: ${itemIds.length} claims share the same ${patientField ? "patient + " : ""}visit date`,
        metadata: toInputJson({
          dateField: dateField.key,
          patientField: patientField?.key ?? null,
          duplicateItemIds: itemIds.filter((id) => id !== itemId),
        }),
      });
      duplicatesFound++;
    }
  }

  if (inserts.length > 0) {
    await db.validationResult.createMany({ data: inserts });
    logger.info(
      { sessionId, duplicatesFound, groups: groups.size },
      "[cross-item] Duplicate visit checks complete"
    );
  }

  return duplicatesFound;
}
