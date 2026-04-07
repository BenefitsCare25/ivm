import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import type { AIProvider } from "./types";

export async function resolveProviderAndKey(userId: string): Promise<{ provider: AIProvider; apiKey: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      preferredProvider: true,
      apiKeys: { where: { isActive: true }, select: { provider: true, encryptedKey: true } },
    },
  });

  if (user?.apiKeys.length) {
    const preferred = user.preferredProvider
      ? user.apiKeys.find((k) => k.provider === user.preferredProvider)
      : null;
    const key = preferred ?? user.apiKeys[0];
    return {
      provider: key.provider as AIProvider,
      apiKey: decrypt(key.encryptedKey),
    };
  }

  const systemKey = process.env.ANTHROPIC_API_KEY;
  if (systemKey) {
    return { provider: "anthropic", apiKey: systemKey };
  }

  throw new ValidationError(
    "No API key configured. Go to Settings to add your API key for Claude, OpenAI, or Gemini."
  );
}
