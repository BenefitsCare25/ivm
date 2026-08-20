import type { TemplateField } from "@/types/portal";

export interface VisionSourceFile {
  originalName: string;
  storagePath: string;
  mimeType: string;
}

interface SelectVisionSourceArgs<TFile extends VisionSourceFile> {
  files: TFile[];
  preferredName?: string;
  fieldName?: string;
  templateField?: TemplateField;
  pdfFieldSources?: Record<string, string>;
  documentTypesByFile?: Record<string, string>;
}

const BILLING_FIELD_RE = /\b(amount|total|balance|payable|charge|receipt|fee|cost|price|provider|facility|hospital|clinic|payee)\b/i;
const BILLING_DOCUMENT_RE = /\b(invoice|bill|receipt|statement of account|billing|hospital statement)\b/i;

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function findFile<TFile extends VisionSourceFile>(files: TFile[], name?: string): TFile | undefined {
  return name ? files.find((file) => file.originalName === name) : undefined;
}

/** Resolve the most relevant source file instead of blindly checking file 1. */
export function selectVisionSourceFile<TFile extends VisionSourceFile>(
  args: SelectVisionSourceArgs<TFile>
): TFile {
  const { files, preferredName, fieldName, templateField, pdfFieldSources, documentTypesByFile } = args;
  if (files.length === 0) throw new Error("No vision source files available");

  const preferred = findFile(files, preferredName);
  if (preferred) return preferred;

  if (templateField && pdfFieldSources) {
    const mappedNames = [
      templateField.documentFieldName,
      ...(templateField.documentFieldAliases ?? []),
    ].map(normalizeLabel);
    const candidates = Object.entries(pdfFieldSources)
      .map(([label, sourceFile]) => {
        const normalizedLabel = normalizeLabel(label);
        const score = mappedNames.reduce((best, mapped) => {
          if (normalizedLabel === mapped) return Math.max(best, 4);
          if (normalizedLabel.includes(mapped) || mapped.includes(normalizedLabel)) return Math.max(best, 3);
          return best;
        }, 0);
        return { sourceFile, score };
      })
      .sort((a, b) => b.score - a.score);
    const mappedFile = findFile(files, candidates.find((candidate) => candidate.score > 0)?.sourceFile);
    if (mappedFile) return mappedFile;
  }

  const isBillingField = BILLING_FIELD_RE.test(
    [fieldName, templateField?.documentFieldName, ...(templateField?.documentFieldAliases ?? [])]
      .filter(Boolean)
      .join(" ")
  );
  if (isBillingField && documentTypesByFile) {
    const billingEntry = Object.entries(documentTypesByFile).find(([, type]) =>
      BILLING_DOCUMENT_RE.test(type)
    );
    const billingFile = findFile(files, billingEntry?.[0]);
    if (billingFile) return billingFile;
  }

  return files[0];
}
