import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { PROVIDER_MODELS } from "@/lib/validations/api-key";
import { stripMarkdownFences } from "./parse";
import { callCodexJson } from "./codex";
import { callVertexContent, VERTEX_DEFAULT_MODEL_MAX_OUTPUT_TOKENS } from "./vertex";
import { getComparisonSystemPrompt, getComparisonUserPrompt, getTemplatedComparisonUserPrompt } from "./prompts-comparison";
import type { AIProvider, AIUsage } from "./types";
import type { FieldComparison, ComparisonFieldStatus, TemplateField, BusinessRuleResult, RequiredDocumentCheck, DiagnosisAssessment, DocumentLineMatch } from "@/types/portal";

export interface ComparisonRequest {
  pageFields: Record<string, string>;
  pdfFields: Record<string, string>;
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseURL?: string; // Custom base URL for OpenAI-compatible proxies
  templateFields?: TemplateField[];
  /** Override the system prompt (used by full comparison with business rules) */
  systemPromptOverride?: string;
  /** Override the user prompt (used by full comparison with business rules) */
  userPromptOverride?: string;
  /** Receives provider-reported usage before truncation/JSON validation can fail. */
  onUsage?: (usage: AIUsage) => void | Promise<void>;
}

export interface ComparisonResponse {
  fieldComparisons: FieldComparison[];
  matchCount: number;
  mismatchCount: number;
  summary: string;
  businessRuleResults?: BusinessRuleResult[];
  requiredDocumentsCheck?: RequiredDocumentCheck[];
  diagnosisAssessment?: DiagnosisAssessment | null;
  rawResponse: unknown;
  usage?: AIUsage;
}

interface ComparisonCallResult {
  text: string;
  truncated: boolean;
  usage?: AIUsage;
}

export async function compareFields(
  request: ComparisonRequest
): Promise<ComparisonResponse> {
  const { provider } = request;

  logger.info(
    { provider, pageFieldCount: Object.keys(request.pageFields).length, pdfFieldCount: Object.keys(request.pdfFields).length },
    "[ai] Starting field comparison"
  );

  // Full comparison (with business rules) takes priority if userPromptOverride is set
  const userPrompt = request.userPromptOverride
    ?? (request.templateFields
      ? getTemplatedComparisonUserPrompt(request.pageFields, request.pdfFields, request.templateFields)
      : getComparisonUserPrompt(request.pageFields, request.pdfFields));

  let result: ComparisonCallResult;

  if (provider === "anthropic" || provider === "azure-foundry") {
    result = await compareWithAnthropic(request, userPrompt);
  } else if (provider === "openai" || provider === "local") {
    result = await compareWithOpenAI(request, userPrompt);
  } else if (provider === "gemini") {
    result = await compareWithGemini(request, userPrompt);
  } else if (provider === "vertex") {
    result = await compareWithVertex(request, userPrompt);
  } else if (provider === "codex") {
    const response = await callCodexJson(
      request.systemPromptOverride ?? getComparisonSystemPrompt(),
      userPrompt,
      { model: request.model }
    );
    result = { text: response.text, truncated: false };
  } else {
    throw new AppError(`Unsupported provider: ${provider}`, 400, "UNSUPPORTED_PROVIDER");
  }

  if (result.usage) await request.onUsage?.(result.usage);

  if (result.truncated) {
    logger.error(
      { provider, hasFullPrompt: !!request.systemPromptOverride },
      "[ai] Comparison response truncated (max_tokens) — result would be incomplete"
    );
    throw new AppError(
      "AI comparison response was truncated (hit token limit). Reduce the number of fields/rules in this template or split the claim type.",
      500,
      "AI_RESPONSE_TRUNCATED"
    );
  }

  const parsed = parseComparisonResponse(result.text);

  logger.info(
    { matchCount: parsed.matchCount, mismatchCount: parsed.mismatchCount },
    "[ai] Field comparison completed"
  );

  return { ...parsed, rawResponse: result.text, usage: result.usage };
}

// Full prompts (business rules + required docs + many fields) can produce large
// JSON; give them ample headroom so the response is never silently truncated.
const FULL_PROMPT_MAX_TOKENS = 16384;
const BASIC_MAX_TOKENS = 4096;

async function compareWithAnthropic(request: ComparisonRequest, userPrompt: string): Promise<{ text: string; truncated: boolean }> {
  const client = new Anthropic({ apiKey: request.apiKey, ...(request.baseURL ? { baseURL: request.baseURL } : {}) });
  const timeout = request.baseURL ? 180_000 : 60_000; // CLI proxy needs more time; full prompts with business rules can be large
  const maxTokens = request.systemPromptOverride ? FULL_PROMPT_MAX_TOKENS : BASIC_MAX_TOKENS;

  const response = await client.messages.create(
    {
      model: request.model ?? PROVIDER_MODELS.anthropic.defaults.text,
      max_tokens: maxTokens,
      system: request.systemPromptOverride ?? getComparisonSystemPrompt(),
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal: AbortSignal.timeout(timeout) }
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }
  return { text: textBlock.text, truncated: response.stop_reason === "max_tokens" };
}

async function compareWithOpenAI(request: ComparisonRequest, userPrompt: string): Promise<{ text: string; truncated: boolean }> {
  const client = new OpenAI({ apiKey: request.apiKey, ...(request.baseURL ? { baseURL: request.baseURL } : {}) });
  // local self-hosted models are slower; CLI proxy also needs more time than direct OpenAI
  const timeout = request.provider === "local" ? 300_000 : request.baseURL ? 180_000 : 60_000;
  const maxTokens = request.systemPromptOverride ? FULL_PROMPT_MAX_TOKENS : BASIC_MAX_TOKENS;

  const response = await client.chat.completions.create(
    {
      model: request.model ?? PROVIDER_MODELS.openai.defaults.text,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: request.systemPromptOverride ?? getComparisonSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
    },
    { signal: AbortSignal.timeout(timeout) }
  );

  return {
    text: response.choices[0]?.message?.content ?? "",
    truncated: response.choices[0]?.finish_reason === "length",
  };
}

async function compareWithGemini(request: ComparisonRequest, userPrompt: string): Promise<{ text: string; truncated: boolean }> {
  const genAI = new GoogleGenerativeAI(request.apiKey);
  const model = genAI.getGenerativeModel({ model: request.model ?? PROVIDER_MODELS.gemini.defaults.text });

  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    model.generateContent([
      { text: request.systemPromptOverride ?? getComparisonSystemPrompt() },
      { text: userPrompt },
    ]).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini timeout")), 30_000);
    }),
  ]);
  const truncated = result.response.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return { text: result.response.text(), truncated };
}

async function compareWithVertex(request: ComparisonRequest, userPrompt: string): Promise<ComparisonCallResult> {
  const result = await callVertexContent({
    credentialJson: request.apiKey,
    model: request.model ?? PROVIDER_MODELS.vertex.defaults.text,
    systemInstruction: request.systemPromptOverride ?? getComparisonSystemPrompt(),
    parts: [{ text: userPrompt }],
    maxOutputTokens: VERTEX_DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
    timeoutMs: 300_000,
  });
  return { text: result.text, truncated: result.truncated, usage: result.usage };
}

const VALID_STATUSES: ComparisonFieldStatus[] = [
  "MATCH", "MISMATCH", "MISSING_IN_PDF", "MISSING_ON_PAGE", "UNCERTAIN",
];

function parseDocumentLineMatches(raw: unknown): DocumentLineMatch[] {
  if (!Array.isArray(raw)) return [];
  const matches: DocumentLineMatch[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const label = e.label != null ? String(e.label).trim() : "";
    const value = e.value != null ? String(e.value).trim() : "";
    if (!label || !value) continue;
    const sourceFile = e.sourceFile != null ? String(e.sourceFile) : undefined;
    matches.push({ label, value, ...(sourceFile ? { sourceFile } : {}) });
  }
  return matches;
}

const VALID_RULE_STATUSES = ["PASS", "FAIL", "WARNING", "NOT_APPLICABLE"] as const;

function parseComparisonResponse(rawText: string): Omit<ComparisonResponse, "rawResponse"> {
  const cleaned = stripMarkdownFences(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const comparisons: FieldComparison[] = (parsed.fieldComparisons ?? []).map(
      (fc: Record<string, unknown>) => {
        const documentLineMatches = parseDocumentLineMatches(fc.documentLineMatches);
        const rawPdfValue = fc.pdfValue != null ? String(fc.pdfValue).trim() : "";
        return {
          fieldName: String(fc.fieldName ?? ""),
          pageValue: fc.pageValue != null ? String(fc.pageValue) : null,
          pdfValue: rawPdfValue || null,
          status: VALID_STATUSES.includes(fc.status as ComparisonFieldStatus)
            ? (fc.status as ComparisonFieldStatus)
            : "UNCERTAIN",
          confidence: typeof fc.confidence === "number" ? fc.confidence : 0.5,
          notes: fc.notes ? String(fc.notes) : undefined,
          ...(documentLineMatches.length > 0 ? { documentLineMatches } : {}),
        };
      }
    );

    const matchCount = comparisons.filter((c) => c.status === "MATCH").length;
    const mismatchCount = comparisons.filter((c) => c.status === "MISMATCH").length;

    // Parse business rule results (optional)
    let businessRuleResults: BusinessRuleResult[] | undefined;
    if (Array.isArray(parsed.businessRuleResults) && parsed.businessRuleResults.length > 0) {
      businessRuleResults = parsed.businessRuleResults.map((r: Record<string, unknown>) => ({
        rule: String(r.rule ?? ""),
        category: String(r.category ?? ""),
        status: VALID_RULE_STATUSES.includes(r.status as (typeof VALID_RULE_STATUSES)[number])
          ? (r.status as BusinessRuleResult["status"])
          : "WARNING",
        evidence: String(r.evidence ?? ""),
        notes: r.notes ? String(r.notes) : undefined,
      }));
    }

    // Parse required document checks (optional)
    let requiredDocumentsCheck: RequiredDocumentCheck[] | undefined;
    if (Array.isArray(parsed.requiredDocumentsCheck) && parsed.requiredDocumentsCheck.length > 0) {
      requiredDocumentsCheck = parsed.requiredDocumentsCheck.map((d: Record<string, unknown>) => ({
        documentTypeName: String(d.documentTypeName ?? ""),
        found: Boolean(d.found),
        notes: d.notes ? String(d.notes) : undefined,
      }));
    }

    // Parse diagnosis assessment (optional)
    const VALID_SOURCES = ["document", "portal", "inferred"] as const;
    let diagnosisAssessment: DiagnosisAssessment | null = null;
    if (parsed.diagnosisAssessment && typeof parsed.diagnosisAssessment === "object") {
      const da = parsed.diagnosisAssessment as Record<string, unknown>;
      if (da.diagnosis && String(da.diagnosis).trim()) {
        const rawSource = String(da.source ?? "inferred");
        diagnosisAssessment = {
          diagnosis: String(da.diagnosis),
          icdCode: da.icdCode ? String(da.icdCode) : null,
          source: VALID_SOURCES.includes(rawSource as typeof VALID_SOURCES[number])
            ? (rawSource as DiagnosisAssessment["source"])
            : "inferred",
          confidence: typeof da.confidence === "number" ? da.confidence : 0.5,
          evidence: String(da.evidence ?? ""),
        };
      }
    }

    return {
      fieldComparisons: comparisons,
      matchCount,
      mismatchCount,
      summary: String(parsed.summary ?? ""),
      businessRuleResults,
      requiredDocumentsCheck,
      diagnosisAssessment,
    };
  } catch {
    logger.error({ rawText: rawText.slice(0, 500) }, "[ai] Failed to parse comparison response");
    throw new AppError("Failed to parse AI comparison response", 500, "AI_PARSE_ERROR");
  }
}
