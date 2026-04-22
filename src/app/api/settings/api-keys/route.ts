import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { validateApiKey } from "@/lib/ai/validate-key";
import { saveApiKeySchema } from "@/lib/validations/api-key";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { authLimiter } from "@/lib/rate-limit";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const [keys, user] = await Promise.all([
      db.userApiKey.findMany({
        where: { userId: session.user.id },
        select: { provider: true, keyPrefix: true, isActive: true, updatedAt: true, endpoint: true },
        orderBy: { createdAt: "asc" },
      }),
      db.user.findUnique({
        where: { id: session.user.id },
        select: { preferredProvider: true, modelPreferences: true },
      }),
    ]);

    return NextResponse.json({
      keys,
      preferredProvider: user?.preferredProvider ?? null,
      modelPreferences: user?.modelPreferences ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await authLimiter(ip);
    if (!rl.allowed) return new Response("Too Many Requests", { status: 429 });

    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = saveApiKeySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid input", { provider: ["Invalid provider or missing API key"] });
    }

    const { provider, apiKey, endpoint, validationModel } = parsed.data;

    // Normalize Azure endpoint: strip /v1/messages suffix users commonly paste
    const normalizedEndpoint = endpoint
      ? endpoint.replace(/\/v1\/messages\/?$/, "").replace(/\/?$/, "/")
      : undefined;

    await validateApiKey(provider, apiKey, normalizedEndpoint, validationModel);

    const encryptedKey = encrypt(apiKey);
    const keyPrefix = maskApiKey(apiKey);

    const result = await db.userApiKey.upsert({
      where: { userId_provider: { userId: session.user.id, provider } },
      create: {
        userId: session.user.id,
        provider,
        encryptedKey,
        keyPrefix,
        endpoint: normalizedEndpoint ?? null,
      },
      update: {
        encryptedKey,
        keyPrefix,
        isActive: true,
        endpoint: normalizedEndpoint ?? null,
      },
      select: { provider: true, keyPrefix: true, isActive: true, updatedAt: true, endpoint: true },
    });

    const existingPreferred = await db.user.findUnique({
      where: { id: session.user.id },
      select: { preferredProvider: true },
    });
    if (!existingPreferred?.preferredProvider) {
      await db.user.update({
        where: { id: session.user.id },
        data: { preferredProvider: provider },
      });
    }

    logger.info({ userId: session.user.id, provider }, "API key saved");

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
