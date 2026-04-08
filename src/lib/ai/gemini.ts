import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { getExtractionSystemPrompt, getExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

const MIME_MAP: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
};

export async function extractWithGemini(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  const mimeType = MIME_MAP[request.mimeType];
  if (!mimeType) {
    throw new AppError(
      `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP.`,
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
    model: "gemini-2.0-flash",
    systemInstruction: getExtractionSystemPrompt(),
  });

  const base64Data = request.fileData.toString("base64");

  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Data } },
    { text: getExtractionUserPrompt(request.fileName) },
  ]);

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
