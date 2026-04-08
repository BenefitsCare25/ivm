import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppError, ValidationError } from "@/lib/errors";
import type { AIProvider } from "@/lib/validations/api-key";

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create(
      {
        model: "claude-sonnet-4-20250514",
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
    throw new ValidationError(`Failed to validate Anthropic key: ${error.message || "Unknown error"}`);
  }
}

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey });
    await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
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
    throw new ValidationError(`Failed to validate OpenAI key: ${error.message || "Unknown error"}`);
  }
}

async function validateGeminiKey(apiKey: string): Promise<boolean> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
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
    throw new ValidationError(`Failed to validate Gemini key: ${msg}`);
  }
}

export async function validateApiKey(provider: AIProvider, apiKey: string): Promise<boolean> {
  switch (provider) {
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAIKey(apiKey);
    case "gemini":
      return validateGeminiKey(apiKey);
  }
}
