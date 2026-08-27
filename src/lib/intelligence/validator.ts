import { db } from "@/lib/db";

export interface ClassifiedDocument {
  documentTypeId: string | null;
  documentTypeName: string | null;
  fileName: string;
}

export interface ValidationCheck {
  ruleType: "DOC_TYPE_MATCH" | "MISSING_DOC" | "REQUIRED_FIELD";
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  metadata: Record<string, unknown>;
}

interface PersistOptions {
  fillSessionId?: string;
  trackedItemId?: string;
}

export async function persistValidationChecks(
  checks: ValidationCheck[],
  options: PersistOptions
): Promise<void> {
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
  extractedFields: { label: string; value: string }[],
  fileName?: string
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const requiredFields = Array.isArray(docType.requiredFields)
    ? docType.requiredFields.filter((field): field is string => typeof field === "string")
    : [];
  if (requiredFields.length === 0) return checks;

  const fieldMap = new Map<string, string>();
  for (const f of extractedFields) {
    fieldMap.set(normalizeFieldLabel(f.label), f.value);
  }

  for (const required of requiredFields) {
    const value = fieldMap.get(normalizeFieldLabel(required));
    if (!value || value.trim() === "") {
      checks.push({
        ruleType: "REQUIRED_FIELD",
        status: "FAIL",
        message: `Required field "${required}" is missing or empty (type: "${docType.name}")`,
        metadata: {
          fieldName: required,
          documentTypeName: docType.name,
          fileName: fileName ?? null,
        },
      });
    }
  }

  return checks;
}

function normalizeFieldLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Collapse repeated required-field misses while retaining every source file. */
export function aggregateRequiredFieldChecks(checks: ValidationCheck[]): ValidationCheck[] {
  const aggregated = new Map<string, ValidationCheck & { metadata: Record<string, unknown> }>();

  for (const check of checks) {
    if (check.ruleType !== "REQUIRED_FIELD") continue;
    const fieldName = typeof check.metadata.fieldName === "string" ? check.metadata.fieldName : "Unknown field";
    const documentTypeName = typeof check.metadata.documentTypeName === "string"
      ? check.metadata.documentTypeName
      : "document";
    const fileName = typeof check.metadata.fileName === "string" ? check.metadata.fileName : null;
    const key = `${normalizeFieldLabel(documentTypeName)}\u0000${normalizeFieldLabel(fieldName)}`;
    const existing = aggregated.get(key);
    const files = existing && Array.isArray(existing.metadata.files)
      ? existing.metadata.files.filter((file): file is string => typeof file === "string")
      : [];
    if (fileName && !files.includes(fileName)) files.push(fileName);

    const count = files.length;
    aggregated.set(key, {
      ruleType: "REQUIRED_FIELD",
      status: "FAIL",
      message: count > 1
        ? `Required field "${fieldName}" is missing or empty in ${count} ${documentTypeName} documents: ${files.join(", ")}`
        : fileName
          ? `Required field "${fieldName}" is missing or empty in "${fileName}" (type: "${documentTypeName}")`
          : `Required field "${fieldName}" is missing or empty (type: "${documentTypeName}")`,
      metadata: {
        fieldName,
        documentTypeName,
        fileName: count === 1 ? files[0] : null,
        files,
        documentCount: count,
      },
    });
  }

  return [...aggregated.values()];
}

export async function validateRequiredFields(
  docType: { name: string; requiredFields: unknown },
  extractedFields: { label: string; value: string }[],
  options: PersistOptions,
  fileName?: string
): Promise<ValidationCheck[]> {
  const checks = validateRequiredFieldsSync(docType, extractedFields, fileName);
  await persistValidationChecks(checks, options);
  return checks;
}

export function buildDocTypeMatchChecks(
  classifiedDocs: ClassifiedDocument[],
  acceptableTypeIds: string[],
  acceptableTypeNames: string[]
): ValidationCheck[] {
  if (acceptableTypeIds.length === 0) return [];
  if (classifiedDocs.some((doc) => doc.documentTypeId && acceptableTypeIds.includes(doc.documentTypeId))) {
    return [];
  }

  const label = acceptableTypeNames.join(" / ") || acceptableTypeIds.join(" / ");
  const recognised = classifiedDocs.filter((doc) => doc.documentTypeId);
  const files = classifiedDocs.map((doc) => doc.fileName);
  if (recognised.length === 0) {
    return [{
      ruleType: "DOC_TYPE_MATCH",
      status: "WARNING",
      message: `No submitted document type was recognised \u2014 expected one of: "${label}"`,
      metadata: { acceptableTypeIds, acceptableTypeNames, files, classifiedDocuments: classifiedDocs },
    }];
  }

  const found = recognised.map(
    (doc) => `${doc.documentTypeName ?? doc.documentTypeId} (${doc.fileName})`
  );
  return [{
    ruleType: "DOC_TYPE_MATCH",
    status: "FAIL",
    message: `Wrong document types submitted: ${found.join(", ")}; expected one of: "${label}"`,
    metadata: {
      acceptableTypeIds,
      acceptableTypeNames,
      files,
      classifiedDocuments: classifiedDocs,
    },
  }];
}

export async function checkAnyDocTypeMatch(
  classifiedDocs: ClassifiedDocument[],
  acceptableTypeIds: string[],
  acceptableTypeNames: string[],
  options: PersistOptions
): Promise<{ flagged: boolean; checks: ValidationCheck[] }> {
  const checks = buildDocTypeMatchChecks(classifiedDocs, acceptableTypeIds, acceptableTypeNames);
  await persistValidationChecks(checks, options);
  return { flagged: checks.length > 0, checks };
}

export async function checkDocTypeMatch(
  classifiedTypeId: string | null,
  classifiedTypeName: string | null,
  acceptableTypeIds: string[],
  acceptableTypeNames: string[],
  options: PersistOptions
): Promise<void> {
  await checkAnyDocTypeMatch(
    [{ documentTypeId: classifiedTypeId, documentTypeName: classifiedTypeName, fileName: "document" }],
    acceptableTypeIds,
    acceptableTypeNames,
    options
  );
}
