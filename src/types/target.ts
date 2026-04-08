export type TargetType = "WEBPAGE" | "PDF" | "DOCX";

export interface TargetField {
  id: string;
  name: string;
  label: string;
  fieldType: "text" | "textarea" | "select" | "checkbox" | "radio" | "date" | "email" | "number" | "other";
  required: boolean;
  options?: string[];
  currentValue?: string;
  selector?: string;
  pageNumber?: number;
}

export interface TargetAssetSummary {
  id: string;
  targetType: TargetType;
  url: string | null;
  fileName: string | null;
  fieldCount: number;
  isSupported: boolean;
  unsupportedReason: string | null;
}

export interface TargetAssetData {
  id: string;
  targetType: TargetType;
  url: string | null;
  fileName: string | null;
  detectedFields: TargetField[];
  fieldCount: number;
  isSupported: boolean;
  unsupportedReason: string | null;
  inspectedAt: string | null;
}
