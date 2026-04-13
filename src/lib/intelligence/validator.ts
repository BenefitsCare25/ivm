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

export async function checkDocTypeMatch(
  classifiedTypeId: string | null,
  classifiedTypeName: string | null,
  expectedTypeId: string,
  expectedTypeName: string,
  options: PersistOptions
): Promise<void> {
  const checks: ValidationCheck[] = [];

  if (!classifiedTypeId) {
    checks.push({
      ruleType: "DOC_TYPE_MATCH",
      status: "WARNING",
      message: `Document type unrecognised — expected "${expectedTypeName}"`,
      metadata: { expectedTypeId, expectedTypeName, classifiedTypeId: null },
    });
  } else if (classifiedTypeId !== expectedTypeId) {
    checks.push({
      ruleType: "DOC_TYPE_MATCH",
      status: "FAIL",
      message: `Wrong document type: got "${classifiedTypeName ?? classifiedTypeId}", expected "${expectedTypeName}"`,
      metadata: { expectedTypeId, expectedTypeName, classifiedTypeId, classifiedTypeName },
    });
  }

  await persistChecks(checks, options);
}
