import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";

export type AIProvider = "anthropic" | "openai" | "gemini";

export interface AIExtractionRequest {
  sourceAssetId: string;
  mimeType: string;
  fileData: Buffer;
  fileName: string;
  provider: AIProvider;
  apiKey: string;
}

export interface AIExtractionResponse {
  documentType: string;
  fields: ExtractedField[];
  rawResponse: unknown;
}

export interface AIMappingRequest {
  extractedFields: ExtractedField[];
  targetFields: TargetField[];
  provider: AIProvider;
  apiKey: string;
}

export interface AIMappingResponse {
  mappings: FieldMapping[];
  rawResponse: unknown;
}
