import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { extractFieldsFromDocument } from "@/lib/ai";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError, AppError } from "@/lib/errors";
import { enqueueAndWaitExtraction } from "@/lib/queue/extraction-queue";
import type { AIProvider } from "@/lib/ai/types";
import { getExtractionCounter, getExtractionDuration } from "@/lib/metrics";
import { aiLimiter } from "@/lib/rate-limit";
import { toInputJson } from "@/lib/utils";

async function runExtractionInline(
  sessionId: string,
  extractionId: string,
  sourceAsset: { id: string; storagePath: string; mimeType: string; originalName: string },
  provider: AIProvider,
  apiKey: string,
  userId: string,
  model?: string,
  baseURL?: string,
  displayProvider?: string
) {
  const shownProvider = displayProvider ?? provider;
  const durationTimer = getExtractionDuration().startTimer({ provider: shownProvider });
  try {
    const storage = getStorageAdapter();
    const fileData = await storage.download(sourceAsset.storagePath);

    const result = await extractFieldsFromDocument({
      sourceAssetId: sourceAsset.id,
      mimeType: sourceAsset.mimeType,
      fileData,
      fileName: sourceAsset.originalName,
      provider,
      apiKey,
      model,
      baseURL,
      storagePath: sourceAsset.storagePath,
    });

    durationTimer();
    getExtractionCounter().inc({ provider: shownProvider, status: "completed" });

    const [updated] = await Promise.all([
      db.extractionResult.update({
        where: { id: extractionId },
        data: {
          status: "COMPLETED",
          documentType: result.documentType,
          fields: toInputJson(result.fields),
          rawResponse: toInputJson(result.rawResponse),
          completedAt: new Date(),
        },
      }),
      db.fillSession.updateMany({
        where: { id: sessionId, userId },
        data: { status: "EXTRACTED", currentStep: "EXTRACT" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: sessionId,
          eventType: "EXTRACTION_COMPLETED",
          actor: "SYSTEM",
          payload: {
            extractionId,
            provider: shownProvider,
            documentType: result.documentType,
            fieldCount: result.fields.length,
          },
        },
      }),
    ]);

    logger.info(
      { sessionId, extractionId, provider: shownProvider, fieldCount: result.fields.length },
      "Extraction completed"
    );

    return updated;
  } catch (aiErr) {
    durationTimer();
    getExtractionCounter().inc({ provider: shownProvider, status: "failed" });
    const errorMessage = aiErr instanceof Error ? aiErr.message : "Unknown extraction error";

    await Promise.all([
      db.extractionResult.update({
        where: { id: extractionId },
        data: { status: "FAILED", errorMessage, completedAt: new Date() },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: sessionId,
          eventType: "EXTRACTION_FAILED",
          actor: "SYSTEM",
          payload: { extractionId, provider: shownProvider, error: errorMessage },
        },
      }),
    ]);

    logger.error({ err: aiErr, sessionId, extractionId, provider: shownProvider }, "Extraction failed");

    if (aiErr instanceof AppError) throw aiErr;
    throw new AppError(`Extraction failed: ${errorMessage}`, 500, "EXTRACTION_FAILED");
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const rl = await aiLimiter(session.user.id);
    if (!rl.allowed) return new Response("Too Many Requests", { status: 429 });

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const sourceAsset = fillSession.sourceAssets[0];
    if (!sourceAsset) {
      throw new ValidationError("No source document uploaded. Upload a file first.");
    }

    const { provider, apiKey, visionModel, baseURL, displayProvider } = await resolveProviderAndKey(session.user.id);

    const extraction = await db.extractionResult.create({
      data: {
        fillSessionId: id,
        sourceAssetId: sourceAsset.id,
        provider: displayProvider,
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

    // Try BullMQ queue first; fall back to inline if Redis is unavailable
    const queueResult = await enqueueAndWaitExtraction({
      sessionId: id,
      sourceAssetId: sourceAsset.id,
      userId: session.user.id,
    }).catch(() => null); // treat queue errors as unavailable

    if (queueResult !== null) {
      // Job was processed by a worker — fetch the updated extraction record
      const updated = await db.extractionResult.findUnique({ where: { id: extraction.id } });
      if (!updated) throw new AppError("Extraction record not found after queue processing", 500, "EXTRACTION_FAILED");
      if (updated.status === "FAILED") {
        throw new AppError(updated.errorMessage ?? "Extraction failed", 500, "EXTRACTION_FAILED");
      }
      return NextResponse.json(updated);
    }

    // Inline extraction fallback (no Redis configured)
    const updated = await runExtractionInline(
      id,
      extraction.id,
      sourceAsset,
      provider,
      apiKey,
      session.user.id,
      visionModel,
      baseURL,
      displayProvider
    );

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
