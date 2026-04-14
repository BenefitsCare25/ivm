import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getExtractionSystemPrompt, getExtractionUserPrompt, getTextExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

const MIME_MAP: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
};

export async function extractWithGemini(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  if (request.textContent) {
    logger.info(
      { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "gemini" },
      "Starting AI extraction (text-only)"
    );

    const genAI = new GoogleGenerativeAI(request.apiKey);
    const model = genAI.getGenerativeModel({
      model: request.model ?? env.GEMINI_MODEL,
      systemInstruction: getExtractionSystemPrompt(request.knownDocumentTypes),
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new AppError("AI extraction timed out after 60s", 504, "AI_TIMEOUT")), 60_000);
    });

    let result: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      result = await Promise.race([
        model.generateContent([{ text: getTextExtractionUserPrompt(request.fileName, request.textContent) }]),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = result.response.text();
    if (!text) throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");

    const { documentType, fields } = parseExtractionResponse(text);
    logger.info({ sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length }, "AI extraction completed");
    return { documentType, fields, rawResponse: result.response };
  }

  const mimeType = MIME_MAP[request.mimeType];
  if (!mimeType) {
    throw new AppError(
      `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP, DOCX.`,
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  logger.info(
    { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "gemini" },
    "Starting AI extraction"
  );

  const genAI = new GoogleGenerativeAI(request.apiKey);
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: getExtractionSystemPrompt(),
  });

  const base64Data = request.fileData.toString("base64");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AppError("AI extraction timed out after 60s", 504, "AI_TIMEOUT")), 60_000);
  });

  let result: Awaited<ReturnType<typeof model.generateContent>>;
  try {
    result = await Promise.race([
      model.generateContent([
        { inlineData: { mimeType, data: base64Data } },
        { text: getExtractionUserPrompt(request.fileName) },
      ]),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  const text = result.response.text();
  if (!text) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  const { documentType, fields } = parseExtractionResponse(text);

  logger.info(
    { sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length },
    "AI extraction completed"
  );

  return { documentType, fields, rawResponse: result.response };
}
