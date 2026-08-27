export interface ExtractedFieldValue {
  label: string;
  value: string;
  rawText?: string;
}

export interface ExtractedDocumentFields {
  fileName: string;
  fields: ExtractedFieldValue[];
}

export interface DocumentExtractionSnapshot extends ExtractedDocumentFields {
  documentType: string;
}

export interface MergedDocumentFields {
  fields: Record<string, string>;
  rawFields: Record<string, string>;
  sources: Record<string, string>;
}

function normalizedLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate the lossless per-file extraction snapshot read from persisted JSON. */
export function parseDocumentExtractions(value: unknown): DocumentExtractionSnapshot[] | null {
  if (!Array.isArray(value)) return null;
  const documents: DocumentExtractionSnapshot[] = [];

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.fileName !== "string" ||
      typeof candidate.documentType !== "string" ||
      !Array.isArray(candidate.fields)
    ) {
      return null;
    }
    const fields: ExtractedFieldValue[] = [];
    for (const field of candidate.fields) {
      if (!isRecord(field) || typeof field.label !== "string" || typeof field.value !== "string") {
        return null;
      }
      fields.push({
        label: field.label,
        value: field.value,
        ...(typeof field.rawText === "string" ? { rawText: field.rawText } : {}),
      });
    }
    documents.push({
      fileName: candidate.fileName,
      documentType: candidate.documentType,
      fields,
    });
  }

  return documents;
}

/**
 * Recover the best possible per-file view for results created before snapshots
 * existed. Every stored file/type is retained, even when no comparison row was
 * mapped back to it.
 */
export function resolveDocumentExtractions(
  snapshot: unknown,
  documentTypesByFile: Record<string, string>,
  comparisons: Array<{ fieldName: string; pdfValue: string | null; sourceFile?: string }>
): DocumentExtractionSnapshot[] {
  const parsed = parseDocumentExtractions(snapshot);
  if (parsed && parsed.length > 0) return parsed;

  const byFile = new Map<string, DocumentExtractionSnapshot>();
  for (const [fileName, documentType] of Object.entries(documentTypesByFile)) {
    byFile.set(fileName, { fileName, documentType, fields: [] });
  }
  const soleFile = byFile.size === 1 ? [...byFile.keys()][0] : null;

  for (const comparison of comparisons) {
    if (comparison.pdfValue == null) continue;
    const fileName = comparison.sourceFile ?? soleFile ?? "document";
    const document = byFile.get(fileName) ?? {
      fileName,
      documentType: documentTypesByFile[fileName] ?? "",
      fields: [],
    };
    document.fields.push({ label: comparison.fieldName, value: comparison.pdfValue });
    byFile.set(fileName, document);
  }

  return [...byFile.values()];
}

/**
 * Flatten per-document extraction results without discarding repeated labels.
 *
 * A plain object assignment silently kept only the last invoice's value when two
 * files both contained fields such as "Invoice Number" or "Total Amount". Labels
 * that occur more than once are qualified with a stable document index so every
 * value and its source remain available to comparison and validation code.
 */
export function mergeDocumentFields(
  documents: ExtractedDocumentFields[]
): MergedDocumentFields {
  const labelCounts = new Map<string, number>();
  for (const document of documents) {
    for (const field of document.fields) {
      const key = normalizedLabel(field.label);
      if (key) labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
  }

  const fields: Record<string, string> = {};
  const rawFields: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const keyOccurrences = new Map<string, number>();

  documents.forEach((document, documentIndex) => {
    for (const field of document.fields) {
      const label = field.label.trim();
      if (!label) continue;
      const normalized = normalizedLabel(label);
      const repeated = (labelCounts.get(normalized) ?? 0) > 1;
      const baseKey = repeated ? `${label} [Document ${documentIndex + 1}]` : label;
      const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
      keyOccurrences.set(baseKey, occurrence);
      const key = occurrence === 1 ? baseKey : `${baseKey} [Occurrence ${occurrence}]`;

      fields[key] = field.value;
      rawFields[key] = field.rawText ?? field.value;
      sources[key] = document.fileName;
    }
  });

  return { fields, rawFields, sources };
}
