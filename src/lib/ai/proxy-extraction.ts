import path from "node:path";
import OpenAI from "openai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { getExtractionSystemPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

/**
 * Extraction via CLI proxy + Read tool.
 *
 * Instead of sending base64 content blocks (which CLI proxies can't handle),
 * this tells Claude to use its Read tool to open the file from disk, then
 * extract fields from the multimodal content it sees.
 *
 * Requires `storagePath` on the request so we can resolve the absolute path.
 */
export async function extractWithProxyReadTool(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  if (!request.storagePath) {
    throw new AppError(
      "storagePath required for proxy Read-tool extraction",
      400,
      "MISSING_STORAGE_PATH"
    );
  }

  const basePath = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
  const absolutePath = path.resolve(basePath, request.storagePath);

  const client = new OpenAI({
    apiKey: request.apiKey,
    ...(request.baseURL ? { baseURL: request.baseURL } : {}),
  });

  const systemPrompt = getExtractionSystemPrompt(request.knownDocumentTypes);

  const userPrompt = `You MUST follow these steps exactly:

STEP 1: Use your Read tool to read the file at this path:
${absolutePath}

STEP 2: After reading the file content, extract ALL data fields from the document.

STEP 3: Return ONLY the raw JSON object — no markdown fences, no explanation, no conversational text before or after.

File name: ${request.fileName}

${systemPrompt}`;

  logger.info(
    {
      sourceAssetId: request.sourceAssetId,
      fileName: request.fileName,
      absolutePath,
      provider: "proxy-readtool",
    },
    "Starting proxy Read-tool extraction"
  );

  const response = await client.chat.completions.create(
    {
      model: request.model ?? "claude-sonnet-4-6",
      max_tokens: 64000,
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal: AbortSignal.timeout(180_000) }
  );

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new AppError(
      "Proxy returned no text response",
      500,
      "AI_EMPTY_RESPONSE"
    );
  }

  logger.debug(
    { responseLength: text.length, first200: text.slice(0, 200) },
    "Proxy raw response preview"
  );

  const { documentType, fields } = parseExtractionResponse(text);

  logger.info(
    {
      sourceAssetId: request.sourceAssetId,
      documentType,
      fieldCount: fields.length,
    },
    "Proxy Read-tool extraction completed"
  );

  return { documentType, fields, rawResponse: response };
}
