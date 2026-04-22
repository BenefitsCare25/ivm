import path from "node:path";
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { PROVIDER_MODELS } from "@/lib/validations/api-key";
import { stripMarkdownFences, extractJsonObject } from "./parse";
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
  baseURL?: string; // Custom base URL for OpenAI-compatible proxies
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

  // CLI proxy drops base64 image_url blocks — use Read-tool path instead
  // Only applies to the OpenAI-compatible proxy, not Azure Foundry
  if (request.baseURL && provider === "openai") {
    rawText = await analyzeWithProxy(request);
  } else if (provider === "anthropic" || provider === "azure-foundry") {
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

async function analyzeWithProxy(request: PageAnalysisRequest): Promise<string> {
  // Save screenshot to temp file so Claude can Read it via the CLI proxy
  const basePath = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
  const tmpDir = path.join(basePath, "tmp-analysis");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `analyze-${Date.now()}.png`);
  await fs.writeFile(tmpFile, request.screenshot);
  const absolutePath = path.resolve(tmpFile);

  try {
    const client = new OpenAI({
      apiKey: request.apiKey,
      ...(request.baseURL ? { baseURL: request.baseURL } : {}),
    });

    const systemPrompt = getPageAnalysisSystemPrompt();
    const userPrompt = `You MUST follow these steps exactly:

STEP 1: Use your Read tool to read the screenshot at this path:
${absolutePath}

STEP 2: After viewing the screenshot, also analyze this HTML snapshot of the page:

${request.htmlSnippet.slice(0, 30000)}

STEP 3: ${getPageAnalysisUserPrompt(request.url, "")}

STEP 4: Return ONLY the raw JSON object — no markdown fences, no explanation, no conversational text before or after.`;

    logger.info(
      { url: request.url, absolutePath, provider: "proxy-readtool" },
      "[ai] Starting proxy Read-tool page analysis"
    );

    const response = await client.chat.completions.create(
      {
        model: request.model ?? "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      { signal: AbortSignal.timeout(120_000) }
    );

    const text = response.choices[0]?.message?.content ?? "";
    if (!text) {
      throw new AppError("Proxy returned no text response", 500, "AI_EMPTY_RESPONSE");
    }

    logger.debug(
      { responseLength: text.length, first200: text.slice(0, 200) },
      "[ai] Proxy page analysis raw response"
    );

    return text;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function analyzeWithAnthropic(request: PageAnalysisRequest): Promise<string> {
  const client = new Anthropic({ apiKey: request.apiKey, ...(request.baseURL ? { baseURL: request.baseURL } : {}) });
  const base64 = request.screenshot.toString("base64");

  const response = await client.messages.create(
    {
      model: request.model ?? PROVIDER_MODELS.anthropic.defaults.vision,
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
  const client = new OpenAI({ apiKey: request.apiKey, ...(request.baseURL ? { baseURL: request.baseURL } : {}) });
  const base64 = request.screenshot.toString("base64");

  const response = await client.chat.completions.create(
    {
      model: request.model ?? PROVIDER_MODELS.openai.defaults.vision,
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
  const model = genAI.getGenerativeModel({ model: request.model ?? PROVIDER_MODELS.gemini.defaults.vision });
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

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const extracted = extractJsonObject(rawText, ["pageType", "listSelectors"]);
    if (!extracted) {
      logger.error({ rawText: rawText.slice(0, 500) }, "[ai] Failed to parse page analysis response");
      throw new AppError("Failed to parse AI page analysis response", 500, "AI_PARSE_ERROR");
    }
    parsed = JSON.parse(extracted);
  }

  const ls = (parsed.listSelectors ?? {}) as Record<string, unknown>;
  const ds = (parsed.detailSelectors ?? {}) as Record<string, unknown>;

  return {
    pageType: (parsed.pageType as PageAnalysisResponse["pageType"]) ?? "other",
    description: (parsed.description as string) ?? "",
    listSelectors: {
      tableSelector: ls.tableSelector as string | undefined,
      rowSelector: ls.rowSelector as string | undefined,
      columns: ls.columns as ListSelectors["columns"],
      detailLinkSelector: ls.detailLinkSelector as string | undefined,
      paginationSelector: ls.paginationSelector as string | undefined,
    },
    detailSelectors: {
      fieldSelectors: ds.fieldSelectors as DetailSelectors["fieldSelectors"],
      downloadLinkSelector: ds.downloadLinkSelector as string | undefined,
      fileNameSelector: ds.fileNameSelector as string | undefined,
    },
  };
}
