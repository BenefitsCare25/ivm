import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { getMappingSystemPrompt, getMappingUserPrompt } from "./prompts";
import { parseMappingResponse } from "./parse-mapping";
import type { AIMappingRequest, AIMappingResponse } from "./types";

interface TextCallResult {
  rawText: string;
  rawResponse: unknown;
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<TextCallResult> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : null;

  if (!rawText) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  return { rawText, rawResponse: response };
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<TextCallResult> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawText = response.choices[0]?.message?.content ?? null;

  if (!rawText) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  return { rawText, rawResponse: response };
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<TextCallResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent([{ text: userPrompt }]);
  const rawText = result.response.text();

  if (!rawText) {
    throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");
  }

  return { rawText, rawResponse: result.response };
}

export async function proposeFieldMappings(
  request: AIMappingRequest
): Promise<AIMappingResponse> {
  const { provider, apiKey, extractedFields, targetFields } = request;

  const systemPrompt = getMappingSystemPrompt();
  const userPrompt = getMappingUserPrompt(extractedFields, targetFields);

  logger.info(
    {
      provider,
      sourceFieldCount: extractedFields.length,
      targetFieldCount: targetFields.length,
    },
    "Starting AI field mapping"
  );

  let rawText: string;
  let rawResponse: unknown;

  switch (provider) {
    case "anthropic": {
      const result = await callAnthropic(apiKey, systemPrompt, userPrompt);
      rawText = result.rawText;
      rawResponse = result.rawResponse;
      break;
    }
    case "openai": {
      const result = await callOpenAI(apiKey, systemPrompt, userPrompt);
      rawText = result.rawText;
      rawResponse = result.rawResponse;
      break;
    }
    case "gemini": {
      const result = await callGemini(apiKey, systemPrompt, userPrompt);
      rawText = result.rawText;
      rawResponse = result.rawResponse;
      break;
    }
    default: {
      throw new AppError(`Unsupported AI provider: ${provider}`, 400, "INVALID_PROVIDER");
    }
  }

  const mappings = parseMappingResponse(rawText, extractedFields, targetFields);

  const mapped = mappings.filter((m) => m.sourceFieldId !== null).length;
  const unmapped = mappings.length - mapped;

  logger.info(
    { provider, total: mappings.length, mapped, unmapped },
    "AI field mapping complete"
  );

  return { mappings, rawResponse };
}
