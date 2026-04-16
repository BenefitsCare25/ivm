import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getExtractionSystemPrompt, getExtractionUserPrompt, getTextExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const PDF_MIME_TYPE = "application/pdf";

type ImageMediaType = (typeof IMAGE_MIME_TYPES)[number];

function buildContentBlocks(
  request: AIExtractionRequest
): Anthropic.MessageCreateParams["messages"][0]["content"] {
  if (request.textContent) {
    return [
      { type: "text" as const, text: getTextExtractionUserPrompt(request.fileName, request.textContent) },
    ];
  }

  const base64Data = request.fileData.toString("base64");

  if (IMAGE_MIME_TYPES.includes(request.mimeType as ImageMediaType)) {
    return [
      {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: request.mimeType as ImageMediaType,
          data: base64Data,
        },
      },
      { type: "text" as const, text: getExtractionUserPrompt(request.fileName) },
    ];
  }

  if (request.mimeType === PDF_MIME_TYPE) {
    return [
      {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: base64Data,
        },
      },
      { type: "text" as const, text: getExtractionUserPrompt(request.fileName) },
    ];
  }

  throw new AppError(
    `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP.`,
    400,
    "UNSUPPORTED_FILE_TYPE"
  );
}

export async function extractWithAnthropic(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  const client = new Anthropic({
    apiKey: request.apiKey,
    ...(request.baseURL ? { baseURL: request.baseURL } : {}),
  });
  const content = buildContentBlocks(request);

  logger.info(
    { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "anthropic" },
    "Starting AI extraction"
  );

  const response = await client.messages.create(
    {
      model: request.model ?? env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: getExtractionSystemPrompt(request.knownDocumentTypes),
      messages: [{ role: "user", content }],
    },
    { signal: AbortSignal.timeout(60_000) }
  );

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  const { documentType, fields } = parseExtractionResponse(textBlock.text);

  logger.info(
    { sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length },
    "AI extraction completed"
  );

  return { documentType, fields, rawResponse: response };
}
