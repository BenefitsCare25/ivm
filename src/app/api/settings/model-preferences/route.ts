import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { modelPreferencesSchema, PROVIDER_MODELS } from "@/lib/validations/api-key";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import type { ModelPreferences } from "@/lib/validations/api-key";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { modelPreferences: true },
    });

    const saved = (user?.modelPreferences as ModelPreferences | null) ?? {};

    // Merge with defaults so UI always has values
    const merged: Record<string, { visionModel: string; textModel: string }> = {};
    for (const provider of Object.keys(PROVIDER_MODELS) as AIProvider[]) {
      const defaults = PROVIDER_MODELS[provider].defaults;
      merged[provider] = {
        visionModel: saved[provider]?.visionModel ?? defaults.vision,
        textModel: saved[provider]?.textModel ?? defaults.text,
      };
    }

    return NextResponse.json(merged);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = modelPreferencesSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid model preferences");
    }

    // Validate that model IDs exist in PROVIDER_MODELS
    for (const [provider, prefs] of Object.entries(parsed.data)) {
      if (!prefs) continue;
      const providerModels = PROVIDER_MODELS[provider as AIProvider];
      if (!providerModels) continue;

      const modelIds = providerModels.models.map((m) => m.id);
      if (!modelIds.includes(prefs.visionModel)) {
        throw new ValidationError(`Invalid vision model "${prefs.visionModel}" for ${provider}`);
      }
      if (!modelIds.includes(prefs.textModel)) {
        throw new ValidationError(`Invalid text model "${prefs.textModel}" for ${provider}`);
      }
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { modelPreferences: JSON.parse(JSON.stringify(parsed.data)) },
    });

    logger.info({ userId: session.user.id }, "Model preferences updated");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
