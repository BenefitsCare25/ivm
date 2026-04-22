import { z } from "zod";

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "azure-foundry"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const saveApiKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(1, "API key is required"),
  endpoint: z.string().url("Must be a valid URL").optional(),
  validationModel: z.string().optional(),
}).refine(
  (data) => data.provider !== "azure-foundry" || (data.endpoint && data.endpoint.length > 0),
  { message: "Endpoint URL is required for Azure AI Foundry", path: ["endpoint"] }
);

export const preferredProviderSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
});

export const PROVIDER_INFO: Record<AIProvider, { name: string; description: string; placeholder: string; endpointPlaceholder?: string }> = {
  anthropic: {
    name: "Claude (Anthropic)",
    description: "Claude for document extraction and analysis",
    placeholder: "sk-ant-api03-...",
  },
  openai: {
    name: "OpenAI",
    description: "GPT-4.1 for document extraction and analysis",
    placeholder: "sk-proj-...",
  },
  gemini: {
    name: "Google Gemini",
    description: "Gemini 2.5 for document extraction and analysis",
    placeholder: "AIzaSy...",
  },
  "azure-foundry": {
    name: "Azure AI Foundry (Claude)",
    description: "Claude via Microsoft Azure AI Foundry — data not used for training",
    placeholder: "your-azure-api-key",
    endpointPlaceholder: "https://your-resource.services.ai.azure.com/anthropic/  (do not add /v1/messages)",
  },
};

// ─── Model selection ───────────────────────────────────────

export type ModelTier = "vision" | "text";

export interface ModelOption {
  id: string;
  label: string;
  tier: ModelTier[];
  costLabel: string;
}

export interface ProviderModels {
  models: ModelOption[];
  defaults: { vision: string; text: string };
}

export const PROVIDER_MODELS: Record<AIProvider, ProviderModels> = {
  anthropic: {
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: ["vision", "text"], costLabel: "$3 / $15" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: ["vision", "text"], costLabel: "$1 / $5" },
    ],
    defaults: { vision: "claude-sonnet-4-6", text: "claude-haiku-4-5" },
  },
  openai: {
    models: [
      { id: "gpt-4.1", label: "GPT-4.1", tier: ["vision", "text"], costLabel: "$2 / $8" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tier: ["vision", "text"], costLabel: "$0.40 / $1.60" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", tier: ["vision", "text"], costLabel: "$0.10 / $0.40" },
    ],
    defaults: { vision: "gpt-4.1", text: "gpt-4.1-mini" },
  },
  gemini: {
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tier: ["vision", "text"], costLabel: "$2 / $12" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", tier: ["vision", "text"], costLabel: "$0.50 / $3" },
      { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", tier: ["vision", "text"], costLabel: "$0.25 / $1.50" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: ["vision", "text"], costLabel: "$1.25 / $10" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: ["vision", "text"], costLabel: "$0.30 / $2.50" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tier: ["text"], costLabel: "$0.10 / $0.40" },
    ],
    defaults: { vision: "gemini-2.5-flash", text: "gemini-2.5-flash" },
  },
  "azure-foundry": {
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", tier: ["vision", "text"], costLabel: "$15 / $75" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: ["vision", "text"], costLabel: "$3 / $15" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", tier: ["vision", "text"], costLabel: "$5 / $25" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: ["vision", "text"], costLabel: "$1 / $5" },
    ],
    defaults: { vision: "claude-opus-4-7", text: "claude-opus-4-7" },
  },
};

export const modelPreferencesSchema = z.object({
  anthropic: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  openai: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  gemini: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  "azure-foundry": z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
});
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;
