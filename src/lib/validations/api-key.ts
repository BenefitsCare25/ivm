import { z } from "zod";

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const saveApiKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(1, "API key is required"),
});

export const preferredProviderSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
});

export const PROVIDER_INFO: Record<AIProvider, { name: string; description: string; placeholder: string }> = {
  anthropic: {
    name: "Claude (Anthropic)",
    description: "Claude Sonnet for document extraction",
    placeholder: "sk-ant-api03-...",
  },
  openai: {
    name: "OpenAI",
    description: "GPT-4o for document extraction",
    placeholder: "sk-proj-...",
  },
  gemini: {
    name: "Google Gemini",
    description: "Gemini 2.0 Flash for document extraction",
    placeholder: "AIzaSy...",
  },
};
