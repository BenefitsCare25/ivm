import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { stripMarkdownFences } from "./parse";
import { rasterizePdfToImages } from "./pdf-raster";
import { downscaleImages } from "./image-scale";
import { callCodexJson } from "./codex";
import type { AIProvider, RasterImage } from "./types";
import type { VisionVerdict } from "@/types/portal";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const PDF_MIME_TYPE = "application/pdf";

export interface VisionVerifyRequest {
  /** A question framed so that CONFIRMED = the concern/violation is TRUE. */
  question: string;
  fileData: Buffer;
  mimeType: string;
  fileName?: string;
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Pre-rasterized page images (local provider). When set, the PDF is not re-rasterized. */
  images?: RasterImage[];
}

export interface VisionVerifyResult {
  verdict: VisionVerdict;
  explanation: string;
  model: string;
}

const VALID_VERDICTS: VisionVerdict[] = ["CONFIRMED", "REFUTED", "UNCERTAIN"];

function systemPrompt(): string {
  return `You are a meticulous claims-document verifier. You are given a source document (image or PDF) and a single question about it. Look at the actual document content carefully.

Respond with ONLY a JSON object — no markdown, no prose outside the JSON:
{
  "verdict": "CONFIRMED" | "REFUTED" | "UNCERTAIN",
  "explanation": "One or two sentences citing what you saw in the document."
}

- "CONFIRMED": the concern stated in the question is TRUE based on the document.
- "REFUTED": the concern stated in the question is FALSE based on the document.
- "UNCERTAIN": the document is illegible or does not contain enough information to decide.`;
}

function parse(raw: string, model: string): VisionVerifyResult {
  try {
    const parsed = JSON.parse(stripMarkdownFences(raw));
    const verdict = VALID_VERDICTS.includes(parsed.verdict) ? parsed.verdict : "UNCERTAIN";
    return { verdict, explanation: String(parsed.explanation ?? ""), model };
  } catch {
    return { verdict: "UNCERTAIN", explanation: "Could not parse vision verification response.", model };
  }
}

/**
 * Re-check a single concern against the source document with a vision model.
 * Best-effort: returns UNCERTAIN on any failure rather than throwing, so a
 * verification miss never fails the whole item.
 */
export async function verifyWithVision(req: VisionVerifyRequest): Promise<VisionVerifyResult> {
  const isImage = IMAGE_MIME_TYPES.includes(req.mimeType as (typeof IMAGE_MIME_TYPES)[number]);
  const isPdf = req.mimeType === PDF_MIME_TYPE;
  if (!isImage && !isPdf) {
    return { verdict: "UNCERTAIN", explanation: `Unsupported file type ${req.mimeType}`, model: req.model };
  }

  try {
    if (req.provider === "anthropic" || req.provider === "azure-foundry") {
      return await withAnthropic(req, isImage);
    }
    if (req.provider === "gemini") {
      return await withGemini(req);
    }
    if (req.provider === "openai") {
      if (isPdf) {
        return { verdict: "UNCERTAIN", explanation: "PDF vision verification not supported on this provider.", model: req.model };
      }
      return await withOpenAI(req, [{ data: req.fileData, mimeType: req.mimeType as RasterImage["mimeType"] }]);
    }
    if (req.provider === "local") {
      // Local vision models take images. Reuse caller-supplied rasterized pages when present
      // (avoids re-decoding the same PDF across multiple checks); otherwise rasterize here.
      const base: RasterImage[] = req.images
        ?? (isPdf
          ? await rasterizePdfToImages(req.fileData, { maxPages: 4 })
          : [{ data: req.fileData, mimeType: req.mimeType as RasterImage["mimeType"] }]);
      return await withOpenAI(req, await downscaleImages(base));
    }
    if (req.provider === "codex") {
      const base: RasterImage[] = req.images
        ?? (isPdf
          ? await rasterizePdfToImages(req.fileData, { maxPages: 4 })
          : [{ data: req.fileData, mimeType: req.mimeType as RasterImage["mimeType"] }]);
      const response = await callCodexJson(systemPrompt(), req.question, {
        model: req.model,
        images: await downscaleImages(base),
      });
      return parse(response.text, req.model);
    }
    return { verdict: "UNCERTAIN", explanation: `Unsupported provider ${req.provider}`, model: req.model };
  } catch (err) {
    logger.warn({ err, fileName: req.fileName }, "[vision-verify] verification failed (non-fatal)");
    return { verdict: "UNCERTAIN", explanation: "Vision verification call failed.", model: req.model };
  }
}

async function withAnthropic(req: VisionVerifyRequest, isImage: boolean): Promise<VisionVerifyResult> {
  const client = new Anthropic({ apiKey: req.apiKey, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  const base64 = req.fileData.toString("base64");
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = isImage
    ? [
        { type: "image", source: { type: "base64", media_type: req.mimeType as "image/png", data: base64 } },
        { type: "text", text: req.question },
      ]
    : [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: req.question },
      ];

  const response = await client.messages.create(
    {
      model: req.model,
      max_tokens: 1024,
      system: systemPrompt(),
      messages: [{ role: "user", content }],
    },
    { signal: AbortSignal.timeout(req.baseURL ? 120_000 : 45_000) }
  );
  const textBlock = response.content.find((b) => b.type === "text");
  return parse(textBlock && textBlock.type === "text" ? textBlock.text : "", req.model);
}

async function withOpenAI(req: VisionVerifyRequest, images: RasterImage[]): Promise<VisionVerifyResult> {
  const client = new OpenAI({ apiKey: req.apiKey, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.data.toString("base64")}` },
  }));
  const response = await client.chat.completions.create(
    {
      model: req.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content: [{ type: "text", text: req.question }, ...imageParts],
        },
      ],
    },
    { signal: AbortSignal.timeout(req.provider === "local" ? 240_000 : req.baseURL ? 120_000 : 45_000) }
  );
  return parse(response.choices[0]?.message?.content ?? "", req.model);
}

async function withGemini(req: VisionVerifyRequest): Promise<VisionVerifyResult> {
  const genAI = new GoogleGenerativeAI(req.apiKey);
  const model = genAI.getGenerativeModel({ model: req.model });
  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    model
      .generateContent([
        { text: systemPrompt() },
        { inlineData: { mimeType: req.mimeType, data: req.fileData.toString("base64") } },
        { text: req.question },
      ])
      .finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini timeout")), 45_000);
    }),
  ]);
  return parse(result.response.text(), req.model);
}
