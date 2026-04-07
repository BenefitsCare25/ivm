import { AppError } from "@/lib/errors";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export type { AIExtractionRequest, AIExtractionResponse, AIProvider } from "./types";
export type { AIMappingRequest, AIMappingResponse } from "./types";
export { proposeFieldMappings } from "./mapping";

export async function extractFieldsFromDocument(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  switch (request.provider) {
    case "anthropic":
      return extractWithAnthropic(request);
    case "openai":
      return extractWithOpenAI(request);
    case "gemini":
      return extractWithGemini(request);
    default:
      throw new AppError(`Unsupported AI provider: ${request.provider}`, 400, "INVALID_PROVIDER");
  }
}
