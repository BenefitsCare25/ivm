import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";

export type AIProvider = "codex" | "anthropic" | "openai" | "gemini" | "azure-foundry" | "local";

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
  images?: RasterImage[]; // Pre-rasterized page images (local/Codex providers: PDFs converted to PNGs)
  /**
   * Request the lean output schema ({label, value, rawText} per field only).
   * Set by the portal path, which never consumes id/fieldType/confidence/pageNumber
   * — dropping them cuts output tokens ~40%, a large speedup on throughput-bound
   * local models. The fill-session flow leaves this unset (it uses those keys).
   */
  compactSchema?: boolean;
}

export interface RasterImage {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface AIExtractionResponse {
  documentType: string;
  fields: ExtractedField[];
  rawResponse: unknown;
  truncated?: boolean;
  /** Token accounting for observability (best-effort; populated by the local/OpenAI path). */
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Model stop reason, e.g. "stop" (complete) or "length" (hit max_tokens). */
  finishReason?: string;
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
