import OpenAI from "openai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getExtractionSystemPrompt, getExtractionUserPrompt, getTextExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const PDF_MIME_TYPE = "application/pdf";

function buildUserContent(request: AIExtractionRequest): OpenAI.ChatCompletionContentPart[] {
  if (request.textContent) {
    return [
      { type: "text", text: getTextExtractionUserPrompt(request.fileName, request.textContent) },
    ];
  }

  const base64Data = request.fileData.toString("base64");
  const parts: OpenAI.ChatCompletionContentPart[] = [];

  if (IMAGE_MIME_TYPES.includes(request.mimeType as (typeof IMAGE_MIME_TYPES)[number])) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${request.mimeType};base64,${base64Data}` },
    });
  } else if (request.mimeType === PDF_MIME_TYPE) {
    // Send PDF as base64 image_url — OpenAI-compatible Claude proxies translate this
    // to Anthropic's native document format internally
    parts.push({
      type: "image_url",
      image_url: { url: `data:application/pdf;base64,${base64Data}` },
    });
  } else {
    throw new AppError(
      `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP.`,
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  parts.push({ type: "text", text: getExtractionUserPrompt(request.fileName) });
  return parts;
}

export async function extractWithOpenAI(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  const client = new OpenAI({ apiKey: request.apiKey, ...(request.baseURL ? { baseURL: request.baseURL } : {}) });

  logger.info(
    { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "openai" },
    "Starting AI extraction"
  );

  const response = await client.chat.completions.create(
    {
      model: request.model ?? env.OPENAI_MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: getExtractionSystemPrompt(request.knownDocumentTypes) },
        { role: "user", content: buildUserContent(request) },
      ],
    },
    { signal: AbortSignal.timeout(60_000) }
  );

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  const { documentType, fields } = parseExtractionResponse(text);

  logger.info(
    { sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length },
    "AI extraction completed"
  );

  return { documentType, fields, rawResponse: response };
}
