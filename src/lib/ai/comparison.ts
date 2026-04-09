import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { PROVIDER_MODELS } from "@/lib/validations/api-key";
import { stripMarkdownFences } from "./parse";
import { getComparisonSystemPrompt, getComparisonUserPrompt, getTemplatedComparisonUserPrompt } from "./prompts-comparison";
import type { AIProvider } from "./types";
import type { FieldComparison, ComparisonFieldStatus, TemplateField } from "@/types/portal";

export interface ComparisonRequest {
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  provider: AIProvider;
  apiKey: string;
  model?: string;
  templateFields?: TemplateField[];
}

export interface ComparisonResponse {
  fieldComparisons: FieldComparison[];
  matchCount: number;
  mismatchCount: number;
  summary: string;
  rawResponse: unknown;
}

export async function compareFields(
  request: ComparisonRequest
): Promise<ComparisonResponse> {
  const { provider } = request;

  logger.info(
    { provider, pageFieldCount: Object.keys(request.pageFields).length, pdfFieldCount: Object.keys(request.pdfFields).length },
    "[ai] Starting field comparison"
  );

  const userPrompt = request.templateFields
    ? getTemplatedComparisonUserPrompt(request.pageFields, request.pdfFields, request.templateFields)
    : getComparisonUserPrompt(request.pageFields, request.pdfFields);

  let rawText: string;

  if (provider === "anthropic") {
    rawText = await compareWithAnthropic(request, userPrompt);
  } else if (provider === "openai") {
    rawText = await compareWithOpenAI(request, userPrompt);
  } else if (provider === "gemini") {
    rawText = await compareWithGemini(request, userPrompt);
  } else {
    throw new AppError(`Unsupported provider: ${provider}`, 400, "UNSUPPORTED_PROVIDER");
  }

  const parsed = parseComparisonResponse(rawText);

  logger.info(
    { matchCount: parsed.matchCount, mismatchCount: parsed.mismatchCount },
    "[ai] Field comparison completed"
  );

  return { ...parsed, rawResponse: rawText };
}

async function compareWithAnthropic(request: ComparisonRequest, userPrompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: request.apiKey });

  const response = await client.messages.create(
    {
      model: request.model ?? PROVIDER_MODELS.anthropic.defaults.text,
      max_tokens: 4096,
      system: getComparisonSystemPrompt(),
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal: AbortSignal.timeout(30_000) }
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }
  return textBlock.text;
}

async function compareWithOpenAI(request: ComparisonRequest, userPrompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: request.apiKey });

  const response = await client.chat.completions.create(
    {
      model: request.model ?? PROVIDER_MODELS.openai.defaults.text,
      max_tokens: 4096,
      messages: [
        { role: "system", content: getComparisonSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
    },
    { signal: AbortSignal.timeout(30_000) }
  );

  return response.choices[0]?.message?.content ?? "";
}

async function compareWithGemini(request: ComparisonRequest, userPrompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(request.apiKey);
  const model = genAI.getGenerativeModel({ model: request.model ?? PROVIDER_MODELS.gemini.defaults.text });

  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    model.generateContent([
      { text: getComparisonSystemPrompt() },
      { text: userPrompt },
    ]).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini timeout")), 30_000);
    }),
  ]);
  return result.response.text();
}

const VALID_STATUSES: ComparisonFieldStatus[] = [
  "MATCH", "MISMATCH", "MISSING_IN_PDF", "MISSING_ON_PAGE", "UNCERTAIN",
];

function parseComparisonResponse(rawText: string): Omit<ComparisonResponse, "rawResponse"> {
  const cleaned = stripMarkdownFences(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const comparisons: FieldComparison[] = (parsed.fieldComparisons ?? []).map(
      (fc: Record<string, unknown>) => ({
        fieldName: String(fc.fieldName ?? ""),
        pageValue: fc.pageValue != null ? String(fc.pageValue) : null,
        pdfValue: fc.pdfValue != null ? String(fc.pdfValue) : null,
        status: VALID_STATUSES.includes(fc.status as ComparisonFieldStatus)
          ? (fc.status as ComparisonFieldStatus)
          : "UNCERTAIN",
        confidence: typeof fc.confidence === "number" ? fc.confidence : 0.5,
        notes: fc.notes ? String(fc.notes) : undefined,
      })
    );

    const matchCount = comparisons.filter((c) => c.status === "MATCH").length;
    const mismatchCount = comparisons.filter((c) => c.status === "MISMATCH").length;

    return {
      fieldComparisons: comparisons,
      matchCount,
      mismatchCount,
      summary: String(parsed.summary ?? ""),
    };
  } catch {
    logger.error({ rawText: rawText.slice(0, 500) }, "[ai] Failed to parse comparison response");
    throw new AppError("Failed to parse AI comparison response", 500, "AI_PARSE_ERROR");
  }
}
