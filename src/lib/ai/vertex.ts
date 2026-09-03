import { GoogleGenAI } from "@google/genai";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getExtractionSystemPrompt, getExtractionUserPrompt, getTextExtractionUserPrompt } from "./prompts";
import { parseExtractionResponse } from "./parse";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export const VERTEX_LOCATION = "asia-southeast1";
export const VERTEX_DEFAULT_MODEL = "gemini-3.5-flash";
export const VERTEX_CAPACITY_HEADER = "X-Vertex-AI-LLM-Request-Type";
export const VERTEX_CAPACITY_REQUEST_TYPE = "shared";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_CREDENTIAL_LENGTH = 20_000;
const MIME_MAP: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
};

export interface VertexServiceAccount extends Record<string, unknown> {
  type: "service_account";
  project_id: string;
  private_key: string;
  client_email: string;
}

export interface VertexPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export class VertexCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VertexCredentialError";
  }
}

export function parseVertexServiceAccount(value: string): VertexServiceAccount {
  if (!value.trim() || value.length > MAX_CREDENTIAL_LENGTH) {
    throw new VertexCredentialError("Service-account JSON is missing or too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VertexCredentialError("Service-account key is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VertexCredentialError("Service-account key must be a JSON object.");
  }

  const key = parsed as Record<string, unknown>;
  if (
    key.type !== "service_account" ||
    typeof key.project_id !== "string" ||
    typeof key.client_email !== "string" ||
    typeof key.private_key !== "string" ||
    !key.project_id.trim() ||
    !key.client_email.trim() ||
    !key.private_key.includes("BEGIN PRIVATE KEY")
  ) {
    throw new VertexCredentialError(
      "JSON must contain type=service_account, project_id, client_email, and private_key."
    );
  }

  return key as VertexServiceAccount;
}

export function vertexCredentialLabel(value: string): string {
  const key = parseVertexServiceAccount(value);
  return `${key.client_email} · ${VERTEX_LOCATION}`;
}

export function buildVertexClientOptions(credentialJson: string, timeoutMs: number): ConstructorParameters<typeof GoogleGenAI>[0] {
  const credentials = parseVertexServiceAccount(credentialJson);
  return {
    vertexai: true,
    project: credentials.project_id,
    location: VERTEX_LOCATION,
    googleAuthOptions: {
      credentials,
      scopes: [CLOUD_PLATFORM_SCOPE],
    },
    httpOptions: {
      apiVersion: "v1",
      timeout: timeoutMs,
      headers: {
        [VERTEX_CAPACITY_HEADER]: VERTEX_CAPACITY_REQUEST_TYPE,
      },
    },
  };
}

function createVertexClient(credentialJson: string, timeoutMs: number): GoogleGenAI {
  return new GoogleGenAI(buildVertexClientOptions(credentialJson, timeoutMs));
}

export async function callVertexContent(options: {
  credentialJson: string;
  parts: VertexPart[];
  model?: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; rawResponse: unknown; truncated: boolean }> {
  const client = createVertexClient(options.credentialJson, options.timeoutMs ?? 60_000);
  const response = await client.models.generateContent({
    model: options.model ?? VERTEX_DEFAULT_MODEL,
    contents: [{ role: "user", parts: options.parts }],
    config: {
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    },
  });

  const text = response.text ?? "";
  const truncated = response.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return { text, rawResponse: response, truncated };
}

export async function extractWithVertex(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  const isTextOnly = Boolean(request.textContent);
  const mimeType = MIME_MAP[request.mimeType];
  if (!isTextOnly && !mimeType) {
    throw new AppError(
      `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP, DOCX.`,
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  logger.info(
    {
      sourceAssetId: request.sourceAssetId,
      mimeType: request.mimeType,
      fileName: request.fileName,
      provider: "vertex",
      location: VERTEX_LOCATION,
    },
    isTextOnly ? "Starting Vertex extraction (text-only)" : "Starting Vertex extraction"
  );

  const parts: VertexPart[] = isTextOnly
    ? [{ text: getTextExtractionUserPrompt(request.fileName, request.textContent!) }]
    : [
        {
          inlineData: {
            mimeType: mimeType!,
            data: request.fileData.toString("base64"),
          },
        },
        { text: getExtractionUserPrompt(request.fileName) },
      ];

  const result = await callVertexContent({
    credentialJson: request.apiKey,
    model: request.model,
    systemInstruction: getExtractionSystemPrompt(request.knownDocumentTypes, {
      compact: request.compactSchema,
    }),
    parts,
    timeoutMs: 60_000,
  });
  if (!result.text) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  const { documentType, fields } = parseExtractionResponse(result.text);
  logger.info(
    { sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length },
    "Vertex extraction completed"
  );
  return { documentType, fields, rawResponse: result.rawResponse };
}
