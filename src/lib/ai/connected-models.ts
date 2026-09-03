import {
  AI_PROVIDERS,
  PROVIDER_INFO,
  PROVIDER_MODELS,
  type AIProvider,
  type ModelPreferences,
} from "@/lib/validations/api-key";

export interface ConnectedAIModelOption {
  value: string;
  provider: AIProvider;
  providerLabel: string;
  model: string;
  modelLabel: string;
}

export interface PortalAISelection {
  provider: AIProvider;
  model: string;
}

export function serializePortalAISelection(provider: AIProvider, model: string): string {
  return `${provider}:${model}`;
}

export function parsePortalAISelection(value: string | null | undefined): PortalAISelection | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 1) return null;

  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1).trim();
  if (!AI_PROVIDERS.includes(provider as AIProvider) || !model) return null;
  return { provider: provider as AIProvider, model };
}

export function getConnectedAIModelOptions(
  connectedProviders: readonly string[],
  preferences: ModelPreferences | null | undefined
): ConnectedAIModelOption[] {
  const connected = new Set(connectedProviders);
  const options: ConnectedAIModelOption[] = [];

  for (const provider of AI_PROVIDERS) {
    if (!connected.has(provider)) continue;
    const config = PROVIDER_MODELS[provider];
    const models = new Map(
      config.models
        .filter((model) => model.tier.includes("vision") && model.tier.includes("text"))
        .map((model) => [model.id, model.label])
    );

    // Endpoint-backed providers can use deployment-specific model ids. Keep the
    // user's validated selections available even when they are not in the fallback list.
    if (config.freeform) {
      const saved = preferences?.[provider];
      for (const model of [saved?.visionModel, saved?.textModel]) {
        if (model) models.set(model, model);
      }
    }

    for (const [model, modelLabel] of models) {
      options.push({
        value: serializePortalAISelection(provider, model),
        provider,
        providerLabel: PROVIDER_INFO[provider].name,
        model,
        modelLabel,
      });
    }
  }

  return options;
}
