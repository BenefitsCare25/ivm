export interface ExtractedField {
  id: string;
  label: string;
  value: string;
  fieldType: "text" | "date" | "number" | "email" | "phone" | "address" | "name" | "currency" | "other";
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
