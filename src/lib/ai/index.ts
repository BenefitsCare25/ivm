import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { extractTextFromDocx } from "./docx-extractor";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
import { extractWithProxyReadTool } from "./proxy-extraction";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export type { AIExtractionRequest, AIExtractionResponse, AIProvider } from "./types";
export type { AIMappingRequest, AIMappingResponse } from "./types";
export { proposeFieldMappings } from "./mapping";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractFieldsFromDocument(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  let enrichedRequest = request;

  if (request.mimeType === DOCX_MIME) {
    const textContent = await extractTextFromDocx(request.fileData);
    enrichedRequest = { ...request, textContent };
  }

  return withRetry(
    () => {
      // CLI proxy cannot handle base64 content blocks — use Read tool approach
      // Only applies to the OpenAI-compatible proxy, not Azure Foundry (which handles base64 natively)
      if (enrichedRequest.baseURL && enrichedRequest.storagePath && !enrichedRequest.textContent && enrichedRequest.provider === "openai") {
        return extractWithProxyReadTool(enrichedRequest);
      }

      switch (enrichedRequest.provider) {
        case "anthropic":
        case "azure-foundry":
          return extractWithAnthropic(enrichedRequest);
        case "openai":
          return extractWithOpenAI(enrichedRequest);
        case "gemini":
          return extractWithGemini(enrichedRequest);
        default:
          throw new AppError(`Unsupported AI provider: ${enrichedRequest.provider}`, 400, "INVALID_PROVIDER");
      }
    },
    { maxRetries: 2, operation: `extraction:${enrichedRequest.provider}` }
  );
}
