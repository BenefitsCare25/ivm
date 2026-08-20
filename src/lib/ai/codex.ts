import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { getExtractionSystemPrompt, getExtractionUserPrompt, getTextExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import { runCodexTurn } from "./codex-app-server";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export async function callCodexJson(
  systemPrompt: string,
  userPrompt: string,
  options?: { images?: AIExtractionRequest["images"]; model?: string }
): Promise<{ text: string; rawResponse: unknown }> {
  const response = await runCodexTurn({
    systemPrompt,
    userPrompt,
    images: options?.images,
    model: options?.model,
  });
  if (!response.text.trim()) {
    throw new AppError("ChatGPT returned no text response", 502, "AI_EMPTY_RESPONSE");
  }
  return { text: response.text, rawResponse: { threadId: response.threadId, turnId: response.turnId } };
}

export async function extractWithCodex(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  logger.info(
    { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "codex" },
    "Starting ChatGPT OAuth extraction"
  );
  const userPrompt = request.textContent
    ? getTextExtractionUserPrompt(request.fileName, request.textContent)
    : getExtractionUserPrompt(request.fileName);
  const result = await callCodexJson(
    getExtractionSystemPrompt(request.knownDocumentTypes, { compact: request.compactSchema }),
    userPrompt,
    { images: request.images, model: request.model }
  );
  const { documentType, fields } = parseExtractionResponse(result.text);
  logger.info(
    { sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length, provider: "codex" },
    "ChatGPT OAuth extraction completed"
  );
  return {
    documentType,
    fields,
    rawResponse: result.rawResponse,
    truncated: false,
    finishReason: "completed",
  };
}
