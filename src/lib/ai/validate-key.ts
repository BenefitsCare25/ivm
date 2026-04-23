import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppError, ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { AIProvider } from "@/lib/validations/api-key";

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      },
      { signal: AbortSignal.timeout(15_000) }
    );
    return true;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; name?: string };
    if (error.name === "AbortError") {
      throw new ValidationError("Anthropic key validation timed out. Try again.");
    }
    if (error.status === 401) {
      throw new ValidationError("Invalid Anthropic API key. Check your key and try again.");
    }
    if (error.status === 403) {
      throw new ValidationError("Anthropic API key does not have permission. Check your key permissions.");
    }
    // Log full error server-side; return generic message to client
    const { logger } = await import("@/lib/logger");
    logger.warn({ status: error.status, name: error.name }, "[validate-key] Anthropic unexpected error");
    throw new ValidationError("Could not validate Anthropic key. Check the key and try again.");
  }
}

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey });
    await client.chat.completions.create(
      {
        model: env.OPENAI_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      },
      { signal: AbortSignal.timeout(15_000) }
    );
    return true;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; name?: string };
    if (error.name === "AbortError") {
      throw new ValidationError("OpenAI key validation timed out. Try again.");
    }
    if (error.status === 401) {
      throw new ValidationError("Invalid OpenAI API key. Check your key and try again.");
    }
    if (error.status === 403) {
      throw new ValidationError("OpenAI API key does not have permission. Check your key permissions.");
    }
    const { logger } = await import("@/lib/logger");
    logger.warn({ status: error.status, name: error.name }, "[validate-key] OpenAI unexpected error");
    throw new ValidationError("Could not validate OpenAI key. Check the key and try again.");
  }
}

async function validateGeminiKey(apiKey: string): Promise<boolean> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new AppError("Key validation timed out", 504, "AI_TIMEOUT")), 15_000);
    });
    try {
      await Promise.race([model.generateContent("Hi"), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
    return true;
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === "AI_TIMEOUT") {
      throw new ValidationError("Gemini key validation timed out. Try again.");
    }
    const error = err as { status?: number; message?: string };
    const msg = error.message || "Unknown error";
    if (msg.includes("API_KEY_INVALID") || msg.includes("401")) {
      throw new ValidationError("Invalid Google Gemini API key. Check your key and try again.");
    }
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      throw new ValidationError("Gemini API key does not have permission. Enable the Generative AI API.");
    }
    const { logger } = await import("@/lib/logger");
    logger.warn({ name: (err as { name?: string })?.name }, "[validate-key] Gemini unexpected error");
    throw new ValidationError("Could not validate Gemini key. Check the key and try again.");
  }
}

async function validateAzureFoundryKey(apiKey: string, endpoint: string, model?: string): Promise<boolean> {
  // Strip /v1/messages suffix — SDK appends it automatically; users often paste the full URL
  const normalizedEndpoint = endpoint.replace(/\/v1\/messages\/?$/, "").replace(/\/?$/, "/");
  try {
    const client = new Anthropic({ apiKey, baseURL: normalizedEndpoint });
    await client.messages.create(
      {
        model: model ?? env.ANTHROPIC_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      },
      { signal: AbortSignal.timeout(15_000) }
    );
    return true;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; name?: string };
    if (error.name === "AbortError") {
      throw new ValidationError("Azure Foundry key validation timed out. Check your endpoint URL and try again.");
    }
    if (error.status === 401) {
      throw new ValidationError("Invalid Azure AI Foundry API key. Check your key and try again.");
    }
    if (error.status === 403) {
      throw new ValidationError("Azure AI Foundry API key does not have permission. Check your resource access.");
    }
    if (error.status === 404) {
      throw new ValidationError("Azure AI Foundry endpoint not found. URL should end with /anthropic/ — do not include /v1/messages.");
    }
    const { logger } = await import("@/lib/logger");
    logger.warn({ status: error.status, name: error.name }, "[validate-key] Azure Foundry unexpected error");
    throw new ValidationError("Could not validate Azure Foundry key. Check the key and endpoint, then try again.");
  }
}

export async function validateApiKey(provider: AIProvider, apiKey: string, endpoint?: string, model?: string): Promise<boolean> {
  switch (provider) {
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAIKey(apiKey);
    case "gemini":
      return validateGeminiKey(apiKey);
    case "azure-foundry":
      if (!endpoint) throw new ValidationError("Endpoint URL is required for Azure AI Foundry.");
      return validateAzureFoundryKey(apiKey, endpoint, model);
  }
}
