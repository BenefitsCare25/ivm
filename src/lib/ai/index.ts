import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { extractTextFromDocx } from "./docx-extractor";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
import { extractWithCodex } from "./codex";
import { extractWithProxyReadTool } from "./proxy-extraction";
import { rasterizePdfToImages } from "./pdf-raster";
import { downscaleImages } from "./image-scale";
import type { AIExtractionRequest, AIExtractionResponse, RasterImage } from "./types";

export type { AIExtractionRequest, AIExtractionResponse, AIProvider } from "./types";
export type { AIMappingRequest, AIMappingResponse } from "./types";
export { proposeFieldMappings } from "./mapping";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const LOCAL_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];

export async function extractFieldsFromDocument(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  let enrichedRequest = request;

  if (request.mimeType === DOCX_MIME) {
    const textContent = await extractTextFromDocx(request.fileData);
    enrichedRequest = { ...request, textContent };
  }

  // Local vision models (oMLX / Qwen3-VL) accept images, not PDFs, and are bottlenecked
  // by image resolution — rasterize PDFs and downscale all images before sending.
  if ((request.provider === "local" || request.provider === "codex") && !enrichedRequest.textContent) {
    let pages: RasterImage[] | null = null;
    if (request.mimeType === PDF_MIME) {
      pages = await rasterizePdfToImages(request.fileData);
    } else if (LOCAL_IMAGE_MIMES.includes(request.mimeType)) {
      pages = [{ data: request.fileData, mimeType: request.mimeType as RasterImage["mimeType"] }];
    }
    if (pages) {
      enrichedRequest = { ...enrichedRequest, images: await downscaleImages(pages) };
    }
  }

  // Retries cover transient failures only — connection drops, 5xx. Timeouts /
  // aborts are NOT retried (see isRetryableError), so a slow local model never
  // burns extra full timeouts. Local gets a single retry (not 2): a connection
  // drop late in a slow call could otherwise stack two ~5-min attempts and blow
  // the detail worker's per-item budget on a multi-attachment claim.
  const maxRetries = enrichedRequest.provider === "local" ? 1 : 2;

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
        case "local":
          return extractWithOpenAI(enrichedRequest);
        case "gemini":
          return extractWithGemini(enrichedRequest);
        case "codex":
          return extractWithCodex(enrichedRequest);
        default:
          throw new AppError(`Unsupported AI provider: ${enrichedRequest.provider}`, 400, "INVALID_PROVIDER");
      }
    },
    { maxRetries, operation: `extraction:${enrichedRequest.provider}` }
  );
}
