export interface AIUsageModelSummary {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}

export interface AIUsageSummary {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  models: AIUsageModelSummary[];
}

interface UsageEvent {
  payload: unknown;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

// Vertex AI standard on-demand, non-global endpoint pricing effective July 1, 2026.
// This app pins Vertex traffic to asia-southeast1, so regional rates apply.
// Source: https://cloud.google.com/vertex-ai/generative-ai/pricing
const MODEL_PRICES: Record<string, ModelPrice> = {
  "vertex:gemini-3.5-flash": {
    inputUsdPerMillion: 1.65,
    outputUsdPerMillion: 9.90,
  },
};

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function modelPrice(provider: string, model: string): ModelPrice | null {
  return MODEL_PRICES[`${provider.toLowerCase()}:${model.toLowerCase()}`] ?? null;
}

export function summarizeAIUsageEvents(events: UsageEvent[]): AIUsageSummary | null {
  const groups = new Map<string, Omit<AIUsageModelSummary, "estimatedCostUsd" | "inputUsdPerMillion" | "outputUsdPerMillion">>();

  for (const event of events) {
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) continue;
    const payload = event.payload as Record<string, unknown>;
    const inputTokens = tokenCount(payload.inputTokens);
    const outputTokens = tokenCount(payload.outputTokens);
    if (inputTokens === null && outputTokens === null) continue;

    const provider = typeof payload.provider === "string" && payload.provider.trim()
      ? payload.provider.trim()
      : "unknown";
    const model = typeof payload.model === "string" && payload.model.trim()
      ? payload.model.trim()
      : "unknown";
    const key = `${provider.toLowerCase()}:${model.toLowerCase()}`;
    const group = groups.get(key) ?? { provider, model, inputTokens: 0, outputTokens: 0 };
    group.inputTokens += inputTokens ?? 0;
    group.outputTokens += outputTokens ?? 0;
    groups.set(key, group);
  }

  if (groups.size === 0) return null;

  let allUsagePriced = true;
  const models = [...groups.values()].map((group): AIUsageModelSummary => {
    const price = modelPrice(group.provider, group.model);
    if (!price) allUsagePriced = false;
    return {
      ...group,
      estimatedCostUsd: price
        ? (group.inputTokens * price.inputUsdPerMillion + group.outputTokens * price.outputUsdPerMillion) / 1_000_000
        : null,
      inputUsdPerMillion: price?.inputUsdPerMillion ?? null,
      outputUsdPerMillion: price?.outputUsdPerMillion ?? null,
    };
  });

  return {
    inputTokens: models.reduce((sum, model) => sum + model.inputTokens, 0),
    outputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
    estimatedCostUsd: allUsagePriced
      ? models.reduce((sum, model) => sum + (model.estimatedCostUsd ?? 0), 0)
      : null,
    models,
  };
}
