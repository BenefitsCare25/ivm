import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";
import type { DocTypeRecord } from "./classifier";

const log = createChildLogger({ module: "intelligence-validator" });

interface ClassifiedDocument {
  documentTypeId: string | null;
  documentTypeName: string | null;
  fileName: string;
}

interface ValidationCheck {
  ruleType: "DOC_TYPE_MATCH" | "MISSING_DOC" | "REQUIRED_FIELD" | "DUPLICATE";
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  metadata: Record<string, unknown>;
}

interface PersistOptions {
  fillSessionId?: string;
  trackedItemId?: string;
}

async function persistChecks(checks: ValidationCheck[], options: PersistOptions): Promise<void> {
  if (checks.length === 0) return;
  await db.validationResult.createMany({
    data: checks.map((c) => ({
      fillSessionId: options.fillSessionId ?? null,
      trackedItemId: options.trackedItemId ?? null,
      ruleType: c.ruleType,
      status: c.status,
      message: c.message,
      metadata: JSON.parse(JSON.stringify(c.metadata)),
    })),
  });
}

export async function validateDocumentSet(
  userId: string,
  classifiedDocs: ClassifiedDocument[],
  options: PersistOptions
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  const documentSets = await db.documentSet.findMany({
    where: { userId, isActive: true },
    include: {
      items: {
        include: { documentType: { select: { id: true, name: true } } },
      },
    },
  });

  if (documentSets.length === 0) return checks;

  for (const doc of classifiedDocs) {
    if (!doc.documentTypeId) {
      checks.push({
        ruleType: "DOC_TYPE_MATCH",
        status: "WARNING",
        message: `"${doc.fileName}" could not be classified to any known document type`,
        metadata: { fileName: doc.fileName },
      });
    }
  }

  const typeCounts = new Map<string, number>();
  for (const doc of classifiedDocs) {
    if (doc.documentTypeId) {
      typeCounts.set(doc.documentTypeId, (typeCounts.get(doc.documentTypeId) ?? 0) + 1);
    }
  }

  for (const ds of documentSets) {
    let allItemsPass = true;

    for (const item of ds.items) {
      const count = typeCounts.get(item.documentTypeId) ?? 0;

      if (item.isRequired && count < item.minCount) {
        checks.push({
          ruleType: "MISSING_DOC",
          status: "FAIL",
          message: `Missing required "${item.documentType.name}" — need ${item.minCount}, found ${count} (set: "${ds.name}")`,
          metadata: {
            documentSetId: ds.id, documentSetName: ds.name,
            documentTypeId: item.documentTypeId, documentTypeName: item.documentType.name,
            required: item.minCount, found: count,
          },
        });
        allItemsPass = false;
      } else if (!item.isRequired && count === 0) {
        checks.push({
          ruleType: "MISSING_DOC",
          status: "WARNING",
          message: `Optional "${item.documentType.name}" not found (set: "${ds.name}")`,
          metadata: {
            documentSetId: ds.id, documentSetName: ds.name,
            documentTypeId: item.documentTypeId, documentTypeName: item.documentType.name, found: 0,
          },
        });
      } else if (item.maxCount !== null && count > item.maxCount) {
        checks.push({
          ruleType: "MISSING_DOC",
          status: "WARNING",
          message: `Too many "${item.documentType.name}" — max ${item.maxCount}, found ${count} (set: "${ds.name}")`,
          metadata: {
            documentSetId: ds.id, documentSetName: ds.name,
            documentTypeId: item.documentTypeId, documentTypeName: item.documentType.name,
            maxAllowed: item.maxCount, found: count,
          },
        });
      }
    }

    if (allItemsPass && ds.items.length > 0) {
      log.info({ documentSetId: ds.id, documentSetName: ds.name }, "Document set validation passed");
    }
  }

  await persistChecks(checks, options);

  if (checks.length > 0) {
    log.info(
      {
        pass: checks.filter((c) => c.status === "PASS").length,
        fail: checks.filter((c) => c.status === "FAIL").length,
        warning: checks.filter((c) => c.status === "WARNING").length,
      },
      "Validation results saved"
    );
  }

  return checks;
}

export function validateRequiredFieldsSync(
  docType: { name: string; requiredFields: unknown },
  extractedFields: { label: string; value: string }[]
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const requiredFields = (docType.requiredFields as string[]) ?? [];
  if (requiredFields.length === 0) return checks;

  const fieldMap = new Map<string, string>();
  for (const f of extractedFields) {
    fieldMap.set(f.label.toLowerCase(), f.value);
  }

  for (const required of requiredFields) {
    const value = fieldMap.get(required.toLowerCase());
    if (!value || value.trim() === "") {
      checks.push({
        ruleType: "REQUIRED_FIELD",
        status: "FAIL",
        message: `Required field "${required}" is missing or empty (type: "${docType.name}")`,
        metadata: { fieldName: required },
      });
    }
  }

  return checks;
}

export async function validateRequiredFields(
  docType: { name: string; requiredFields: unknown },
  extractedFields: { label: string; value: string }[],
  options: PersistOptions
): Promise<ValidationCheck[]> {
  const checks = validateRequiredFieldsSync(docType, extractedFields);
  await persistChecks(checks, options);
  return checks;
}
