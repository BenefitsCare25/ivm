import { createHash } from "crypto";
import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "intelligence-dedup" });

interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOf: string | null;
  hash: string;
  matchedFields: string[];
}

function computeFieldHash(fields: { label: string; value: string }[], keyFields: string[]): string {
  const normalized = keyFields
    .map((key) => {
      const field = fields.find((f) => f.label.toLowerCase() === key.toLowerCase());
      const val = (field?.value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      return `${key.toLowerCase()}=${val}`;
    })
    .sort()
    .join("|");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export async function checkDuplicate(
  userId: string,
  documentTypeId: string,
  keyFields: string[],
  extractedFields: { label: string; value: string }[],
  options: {
    fillSessionId?: string;
    trackedItemId?: string;
    lookbackDays?: number;
  } = {}
): Promise<DuplicateCheckResult> {
  const noMatch: DuplicateCheckResult = {
    isDuplicate: false,
    duplicateOf: null,
    hash: "",
    matchedFields: [],
  };

  if (keyFields.length === 0) return noMatch;

  const hash = computeFieldHash(extractedFields, keyFields);
  if (!hash) return noMatch;

  const lookbackDays = options.lookbackDays ?? 90;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  // Build exclusion clause only when we have an ID to exclude
  const hasExclusion = options.fillSessionId || options.trackedItemId;

  const existing = await db.validationResult.findFirst({
    where: {
      ruleType: "DUPLICATE",
      metadata: {
        path: ["hash"],
        equals: hash,
      },
      // Scope to same user via documentTypeId in metadata
      AND: [
        { metadata: { path: ["documentTypeId"], equals: documentTypeId } },
      ],
      createdAt: { gte: since },
      ...(hasExclusion
        ? {
            NOT: {
              AND: [
                ...(options.fillSessionId ? [{ fillSessionId: options.fillSessionId }] : []),
                ...(options.trackedItemId ? [{ trackedItemId: options.trackedItemId }] : []),
              ],
            },
          }
        : {}),
    },
    select: {
      fillSessionId: true,
      trackedItemId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const result: DuplicateCheckResult = {
    isDuplicate: !!existing,
    duplicateOf: existing?.fillSessionId ?? existing?.trackedItemId ?? null,
    hash,
    matchedFields: keyFields,
  };

  await db.validationResult.create({
    data: {
      fillSessionId: options.fillSessionId ?? null,
      trackedItemId: options.trackedItemId ?? null,
      ruleType: "DUPLICATE",
      status: result.isDuplicate ? "WARNING" : "PASS",
      message: result.isDuplicate
        ? `Possible duplicate detected (matches ${result.duplicateOf}) — fields: ${keyFields.join(", ")}`
        : `No duplicates found (hash: ${hash.slice(0, 8)}...)`,
      metadata: JSON.parse(
        JSON.stringify({
          hash,
          matchedFields: keyFields,
          documentTypeId,
          duplicateOf: result.duplicateOf,
        })
      ),
    },
  });

  if (result.isDuplicate) {
    log.warn(
      { hash, duplicateOf: result.duplicateOf, documentTypeId },
      "Duplicate document detected"
    );
  }

  return result;
}
