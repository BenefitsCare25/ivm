export const FIELD_TYPES = [
  "text", "date", "number", "email", "phone", "address", "name", "currency", "other",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface ExtractedField {
  id: string;
  label: string;
  value: string;
  fieldType: FieldType;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  pageNumber?: number;
  rawText?: string;
}

export interface ExtractionResultSummary {
  id: string;
  documentType: string | null;
  fieldCount: number;
  status: string;
  provider: string;
  completedAt: string | null;
}

export type ExtractionState = "idle" | "processing" | "completed" | "failed";

export interface SourceAssetData {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}
