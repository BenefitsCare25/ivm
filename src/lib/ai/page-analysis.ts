import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { stripMarkdownFences } from "./parse";
import { getPageAnalysisSystemPrompt, getPageAnalysisUserPrompt } from "./prompts-portal";
import type { AIProvider } from "./types";
import type { ListSelectors, DetailSelectors } from "@/types/portal";

export interface PageAnalysisRequest {
  url: string;
  screenshot: Buffer;
  htmlSnippet: string;
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

export interface PageAnalysisResponse {
  pageType: "list" | "detail" | "login" | "other";
  description: string;
  listSelectors: ListSelectors;
  detailSelectors: DetailSelectors;
  rawResponse: unknown;
}

export async function analyzePageStructure(
  request: PageAnalysisRequest
): Promise<PageAnalysisResponse> {
  const { provider } = request;

  logger.info({ url: request.url, provider }, "[ai] Starting page structure analysis");

  let rawText: string;

  if (provider === "anthropic") {
    rawText = await analyzeWithAnthropic(request);
  } else if (provider === "openai") {
    rawText = await analyzeWithOpenAI(request);
  } else if (provider === "gemini") {
    rawText = await analyzeWithGemini(request);
  } else {
    throw new AppError(`Unsupported provider: ${provider}`, 400, "UNSUPPORTED_PROVIDER");
  }

  const parsed = parsePageAnalysisResponse(rawText);

  logger.info(
    {
      pageType: parsed.pageType,
      columnCount: parsed.listSelectors.columns?.length ?? 0,
      tableSelector: parsed.listSelectors.tableSelector ?? null,
      rowSelector: parsed.listSelectors.rowSelector ?? null,
      detailLinkSelector: parsed.listSelectors.detailLinkSelector ?? null,
      description: parsed.description,
    },
    "[ai] Page analysis completed"
  );

  return { ...parsed, rawResponse: rawText };
}

async function analyzeWithAnthropic(request: PageAnalysisRequest): Promise<string> {
  const client = new Anthropic({ apiKey: request.apiKey });
  const base64 = request.screenshot.toString("base64");

  const response = await client.messages.create(
    {
      model: request.model ?? "claude-sonnet-4-6",
      max_tokens: 4096,
      system: getPageAnalysisSystemPrompt(),
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: base64 },
          },
          {
            type: "text",
            text: getPageAnalysisUserPrompt(request.url, request.htmlSnippet),
          },
        ],
      }],
    },
    { signal: AbortSignal.timeout(60_000) }
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }
  return textBlock.text;
}

async function analyzeWithOpenAI(request: PageAnalysisRequest): Promise<string> {
  const client = new OpenAI({ apiKey: request.apiKey });
  const base64 = request.screenshot.toString("base64");

  const response = await client.chat.completions.create(
    {
      model: request.model ?? "gpt-4.1",
      max_tokens: 4096,
      messages: [
        { role: "system", content: getPageAnalysisSystemPrompt() },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` },
            },
            {
              type: "text",
              text: getPageAnalysisUserPrompt(request.url, request.htmlSnippet),
            },
          ],
        },
      ],
    },
    { signal: AbortSignal.timeout(60_000) }
  );

  return response.choices[0]?.message?.content ?? "";
}

async function analyzeWithGemini(request: PageAnalysisRequest): Promise<string> {
  const genAI = new GoogleGenerativeAI(request.apiKey);
  const model = genAI.getGenerativeModel({ model: request.model ?? "gemini-2.5-flash" });
  const base64 = request.screenshot.toString("base64");

  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    model.generateContent([
      { text: getPageAnalysisSystemPrompt() },
      { inlineData: { mimeType: "image/png", data: base64 } },
      { text: getPageAnalysisUserPrompt(request.url, request.htmlSnippet) },
    ]).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini timeout")), 60_000);
    }),
  ]);
  return result.response.text();
}

function parsePageAnalysisResponse(rawText: string): Omit<PageAnalysisResponse, "rawResponse"> {
  const cleaned = stripMarkdownFences(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    return {
      pageType: parsed.pageType ?? "other",
      description: parsed.description ?? "",
      listSelectors: {
        tableSelector: parsed.listSelectors?.tableSelector,
        rowSelector: parsed.listSelectors?.rowSelector,
        columns: parsed.listSelectors?.columns,
        detailLinkSelector: parsed.listSelectors?.detailLinkSelector,
        paginationSelector: parsed.listSelectors?.paginationSelector,
      },
      detailSelectors: {
        fieldSelectors: parsed.detailSelectors?.fieldSelectors,
        downloadLinkSelector: parsed.detailSelectors?.downloadLinkSelector,
        fileNameSelector: parsed.detailSelectors?.fileNameSelector,
      },
    };
  } catch {
    logger.error({ rawText: rawText.slice(0, 500) }, "[ai] Failed to parse page analysis response");
    throw new AppError("Failed to parse AI page analysis response", 500, "AI_PARSE_ERROR");
  }
}
