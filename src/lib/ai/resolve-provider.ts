import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { PROVIDER_MODELS, type ModelPreferences } from "@/lib/validations/api-key";
import type { AIProvider } from "./types";

export interface ResolvedProvider {
  provider: AIProvider;
  apiKey: string;
  visionModel: string;
  textModel: string;
}

export async function resolveProviderAndKey(userId: string): Promise<ResolvedProvider> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      preferredProvider: true,
      modelPreferences: true,
      apiKeys: { where: { isActive: true }, select: { provider: true, encryptedKey: true } },
    },
  });

  if (user?.apiKeys.length) {
    const preferred = user.preferredProvider
      ? user.apiKeys.find((k) => k.provider === user.preferredProvider)
      : null;
    const key = preferred ?? user.apiKeys[0];
    const provider = key.provider as AIProvider;
    const prefs = (user.modelPreferences as ModelPreferences | null)?.[provider];
    const defaults = PROVIDER_MODELS[provider].defaults;

    return {
      provider,
      apiKey: decrypt(key.encryptedKey),
      visionModel: prefs?.visionModel ?? defaults.vision,
      textModel: prefs?.textModel ?? defaults.text,
    };
  }

  const systemKey = process.env.ANTHROPIC_API_KEY;
  if (systemKey) {
    return {
      provider: "anthropic",
      apiKey: systemKey,
      visionModel: env.ANTHROPIC_MODEL,
      textModel: PROVIDER_MODELS.anthropic.defaults.text,
    };
  }

  throw new ValidationError(
    "No API key configured. Go to Settings to add your API key for Claude, OpenAI, or Gemini."
  );
}
