import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { extractTextFromDocx } from "./docx-extractor";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
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
  if (request.provider === "local" && !enrichedRequest.textContent) {
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
  // burns extra full timeouts; this is safe for local too, and recovers the
  // "connection terminated" drops a self-hosted server throws under load.
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
        default:
          throw new AppError(`Unsupported AI provider: ${enrichedRequest.provider}`, 400, "INVALID_PROVIDER");
      }
    },
    { maxRetries: 2, operation: `extraction:${enrichedRequest.provider}` }
  );
}
