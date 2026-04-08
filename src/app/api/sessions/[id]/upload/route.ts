import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { sanitizeFileName } from "@/lib/utils";
import { validateUploadFile } from "@/lib/validations/upload";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: { sourceAssets: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      throw new ValidationError("No file provided", { file: ["File is required"] });
    }

    const validation = validateUploadFile({ size: file.size, type: file.type, name: file.name });
    if (!validation.valid) {
      throw new ValidationError(validation.error!, { file: [validation.error!] });
    }

    const storage = getStorageAdapter();

    if (fillSession.sourceAssets.length > 0) {
      await Promise.all(
        fillSession.sourceAssets.map((existing) =>
          storage.delete(existing.storagePath).catch((err) => {
            logger.warn({ err, storagePath: existing.storagePath }, "Failed to delete old source file");
          })
        )
      );
      await db.sourceAsset.deleteMany({ where: { fillSessionId: id } });
    }

    const sanitized = sanitizeFileName(file.name);
    const storageKey = `sessions/${id}/sources/${Date.now()}-${sanitized}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await storage.upload(storageKey, buffer, file.type);

    const sourceAsset = await db.sourceAsset.create({
      data: {
        fillSessionId: id,
        fileName: storageKey,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath: storageKey,
        storageProvider: process.env.STORAGE_PROVIDER ?? "local",
      },
    });

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "SOURCE_UPLOADED", currentStep: "SOURCE" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "SOURCE_UPLOADED",
          actor: "USER",
          payload: {
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            sourceAssetId: sourceAsset.id,
          },
        },
      }),
    ]);

    logger.info(
      { sessionId: id, sourceAssetId: sourceAsset.id, fileName: file.name },
      "Source file uploaded"
    );

    return NextResponse.json(sourceAsset, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
