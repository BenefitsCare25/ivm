import { z } from "zod";

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "vertex", "azure-foundry", "local"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

/** Providers that require a user-supplied endpoint URL (custom/self-hosted). */
export const ENDPOINT_PROVIDERS: readonly AIProvider[] = ["azure-foundry", "local"];

export const saveApiKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(1, "API key is required").max(20_000, "Credential is too large"),
  endpoint: z.string().url("Must be a valid URL").optional(),
  validationModel: z.string().optional(),
}).refine(
  (data) => !ENDPOINT_PROVIDERS.includes(data.provider) || (data.endpoint && data.endpoint.length > 0),
  { message: "Endpoint URL is required for this provider", path: ["endpoint"] }
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
  vertex: {
    name: "Google Vertex AI (Singapore)",
    description: "Gemini 3.5 Flash via Vertex AI in asia-southeast1 using Standard PayGo",
    placeholder: "Paste the full service-account JSON key",
  },
  "azure-foundry": {
    name: "Azure AI Foundry (Claude)",
    description: "Claude via Microsoft Azure AI Foundry — data not used for training",
    placeholder: "your-azure-api-key",
    endpointPlaceholder: "https://your-resource.services.ai.azure.com/anthropic/  (do not add /v1/messages)",
  },
  local: {
    name: "Local Model (oMLX / Qwen3-VL)",
    description: "Self-hosted vision model over an OpenAI-compatible endpoint — data stays on-device",
    placeholder: "oMLX API key",
    endpointPlaceholder: "http://100.x.x.x:8000/v1  (Tailscale IP + /v1)",
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
  /** When true, the model id is user-entered free text (id varies per install), not a fixed dropdown. */
  freeform?: boolean;
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
  vertex: {
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (Singapore)", tier: ["vision", "text"], costLabel: "Vertex PayGo" },
    ],
    defaults: { vision: "gemini-3.5-flash", text: "gemini-3.5-flash" },
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
  // Local model ids must match the id oMLX serves (see /v1/models — NOT always the
  // Hugging Face repo name). Freeform + a live picker in Settings; this list is only
  // a fallback shown when the endpoint can't be reached.
  local: {
    freeform: true,
    models: [
      { id: "Qwen3-VL-8B-Instruct-MLX-8bit", label: "Qwen3-VL 8B Instruct (8-bit)", tier: ["vision", "text"], costLabel: "On-device" },
      { id: "Qwen3-VL-32B-Instruct-8bit", label: "Qwen3-VL 32B Instruct (8-bit)", tier: ["vision", "text"], costLabel: "On-device" },
    ],
    defaults: {
      vision: "Qwen3-VL-8B-Instruct-MLX-8bit",
      text: "Qwen3-VL-8B-Instruct-MLX-8bit",
    },
  },
};

export const modelPreferencesSchema = z.object({
  anthropic: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  openai: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  gemini: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  vertex: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  "azure-foundry": z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
  local: z.object({ visionModel: z.string(), textModel: z.string() }).optional(),
});
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;
