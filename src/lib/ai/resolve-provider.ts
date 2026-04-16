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
  baseURL?: string; // Set when routing through a proxy
}

async function isProxyHealthy(url: string): Promise<boolean> {
  try {
    // Strip /v1 suffix — health endpoint lives at server root
    const root = url.replace(/\/v1\/?$/, "");
    const res = await fetch(`${root}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json() as { status?: string; claudeBinaryOk?: boolean };
    return data?.status === "ok" && data?.claudeBinaryOk === true;
  } catch {
    return false;
  }
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

  // 1. User's own BYOK keys take priority
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

  // 2. Claude proxy (pay plan) — used as system default when no BYOK keys
  const proxyUrl = env.CLAUDE_PROXY_URL;
  const proxyToken = env.CLAUDE_PROXY_TOKEN;
  if (proxyUrl && proxyToken && await isProxyHealthy(proxyUrl)) {
    return {
      provider: "openai",
      apiKey: proxyToken,
      baseURL: proxyUrl,
      visionModel: "claude-sonnet-4-6",
      textModel: "claude-sonnet-4-6",
    };
  }

  // 3. System Anthropic API key fallback
  const systemKey = env.ANTHROPIC_API_KEY;
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
