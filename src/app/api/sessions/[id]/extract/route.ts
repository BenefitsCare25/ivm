import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { extractFieldsFromDocument } from "@/lib/ai";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError, AppError } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

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

    const { provider, apiKey } = await resolveProviderAndKey(session.user.id);

    const extraction = await db.extractionResult.create({
      data: {
        fillSessionId: id,
        sourceAssetId: sourceAsset.id,
        provider,
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

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
      });

      const [updated] = await Promise.all([
        db.extractionResult.update({
          where: { id: extraction.id },
          data: {
            status: "COMPLETED",
            documentType: result.documentType,
            fields: JSON.parse(JSON.stringify(result.fields)),
            rawResponse: JSON.parse(JSON.stringify(result.rawResponse)),
            completedAt: new Date(),
          },
        }),
        db.fillSession.updateMany({
          where: { id, userId: session.user.id },
          data: { status: "EXTRACTED", currentStep: "EXTRACT" },
        }),
        db.auditEvent.create({
          data: {
            fillSessionId: id,
            eventType: "EXTRACTION_COMPLETED",
            actor: "SYSTEM",
            payload: {
              extractionId: extraction.id,
              provider,
              documentType: result.documentType,
              fieldCount: result.fields.length,
            },
          },
        }),
      ]);

      logger.info(
        { sessionId: id, extractionId: extraction.id, provider, fieldCount: result.fields.length },
        "Extraction completed"
      );

      return NextResponse.json(updated);
    } catch (aiErr) {
      const errorMessage = aiErr instanceof Error ? aiErr.message : "Unknown extraction error";

      await Promise.all([
        db.extractionResult.update({
          where: { id: extraction.id },
          data: {
            status: "FAILED",
            errorMessage,
            completedAt: new Date(),
          },
        }),
        db.auditEvent.create({
          data: {
            fillSessionId: id,
            eventType: "EXTRACTION_FAILED",
            actor: "SYSTEM",
            payload: { extractionId: extraction.id, provider, error: errorMessage },
          },
        }),
      ]);

      logger.error(
        { err: aiErr, sessionId: id, extractionId: extraction.id, provider },
        "Extraction failed"
      );

      if (aiErr instanceof AppError) throw aiErr;
      throw new AppError(`Extraction failed: ${errorMessage}`, 500, "EXTRACTION_FAILED");
    }
  } catch (err) {
    return errorResponse(err);
  }
}
