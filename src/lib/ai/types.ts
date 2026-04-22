import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";

export type AIProvider = "anthropic" | "openai" | "gemini" | "azure-foundry";

export interface AIExtractionRequest {
  sourceAssetId: string;
  mimeType: string;
  fileData: Buffer;
  fileName: string;
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseURL?: string; // Custom base URL for OpenAI-compatible proxies
  storagePath?: string; // Disk path for proxy Read-tool extraction
  textContent?: string; // Pre-extracted text for DOCX files
  knownDocumentTypes?: string[]; // Constrain AI to pick from this list when provided
}

export interface AIExtractionResponse {
  documentType: string;
  fields: ExtractedField[];
  rawResponse: unknown;
  truncated?: boolean;
}

export interface AIMappingRequest {
  extractedFields: ExtractedField[];
  targetFields: TargetField[];
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseURL?: string; // Custom base URL for OpenAI-compatible proxies
}

export interface AIMappingResponse {
  mappings: FieldMapping[];
  rawResponse: unknown;
}

// Re-export portal AI types for convenience
export type { PageAnalysisRequest, PageAnalysisResponse } from "./page-analysis";
export type { ComparisonRequest, ComparisonResponse } from "./comparison";
