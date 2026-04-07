export interface FieldMapping {
  id: string;
  sourceFieldId: string | null;
  targetFieldId: string;
  sourceLabel: string;
  targetLabel: string;
  sourceValue: string;
  transformedValue: string;
  confidence: number;
  rationale: string;
  userApproved: boolean;
  userOverrideValue?: string;
}

export interface MappingSetSummary {
  id: string;
  status: string;
  mappingCount: number;
  proposedAt: string;
  reviewedAt: string | null;
}

export type MappingState = "idle" | "processing" | "completed" | "failed";
