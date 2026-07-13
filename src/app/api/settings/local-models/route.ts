import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { assertSafeEndpoint } from "@/lib/endpoint-safety";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * List the models currently loaded on the user's self-hosted local endpoint
 * (oMLX `/v1/models`). Powers the live model picker in Settings so users select
 * from what's actually loaded instead of typing exact ids. Never throws to the
 * client for a bad/unreachable endpoint — returns `{ models: [], error }` so the
 * UI can degrade to manual entry.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const key = await db.userApiKey.findFirst({
      where: { userId: session.user.id, provider: "local", isActive: true },
      select: { encryptedKey: true, endpoint: true },
    });

    if (!key?.endpoint) {
      return NextResponse.json({ models: [], error: "No local model endpoint configured." });
    }

    const base = key.endpoint.replace(/\/+$/, "");
    try {
      assertSafeEndpoint(base);
    } catch (e) {
      return NextResponse.json({ models: [], error: e instanceof Error ? e.message : "Endpoint not allowed." });
    }

    let apiKey: string;
    try {
      apiKey = decrypt(key.encryptedKey);
    } catch {
      return NextResponse.json({ models: [], error: "Could not decrypt the stored key." });
    }

    try {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return NextResponse.json({ models: [], error: `Endpoint returned HTTP ${res.status}.` });
      }
      const data = (await res.json()) as { data?: { id?: string }[] };
      const models = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      return NextResponse.json({ models });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      logger.warn({ err: e }, "[local-models] Failed to list models from endpoint");
      return NextResponse.json({
        models: [],
        error: timedOut ? "Endpoint timed out — is oMLX running and reachable?" : "Could not reach the local endpoint.",
      });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
