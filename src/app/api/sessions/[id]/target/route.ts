import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { toInputJson } from "@/lib/utils";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { sanitizeFileName } from "@/lib/utils";
import { targetWebpageSchema, validateTargetFile } from "@/lib/validations/target";
import { inspectTarget } from "@/lib/target/inspect";
import type { TargetField } from "@/types/target";

type RouteContext = { params: Promise<{ id: string }> };

function toTargetResponse(target: {
  id: string;
  targetType: string;
  url: string | null;
  fileName: string | null;
  detectedFields: unknown;
  isSupported: boolean;
  unsupportedReason: string | null;
  inspectedAt: Date | null;
}) {
  const fields = target.detectedFields as TargetField[];
  return {
    id: target.id,
    targetType: target.targetType,
    url: target.url,
    fileName: target.fileName,
    detectedFields: fields,
    fieldCount: fields.length,
    isSupported: target.isSupported,
    unsupportedReason: target.unsupportedReason,
    inspectedAt: target.inspectedAt?.toISOString() ?? null,
  };
}

const VALID_STATUSES_FOR_TARGET = [
  "EXTRACTED",
  "TARGET_SET",
  "MAPPED",
  "FILLED",
  "REVIEWED",
];

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const target = fillSession.targetAssets[0] ?? null;
    if (!target) return NextResponse.json({ target: null });

    return NextResponse.json({ target: toTargetResponse(target) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: { targetAssets: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    if (!VALID_STATUSES_FOR_TARGET.includes(fillSession.status)) {
      throw new ValidationError("Complete extraction before setting a target", {
        status: ["Session must be in EXTRACTED state or later"],
      });
    }

    const storage = getStorageAdapter();

    if (fillSession.targetAssets.length > 0) {
      await Promise.all(
        fillSession.targetAssets
          .filter((t) => t.storagePath)
          .map((t) =>
            storage.delete(t.storagePath!).catch((err) => {
              logger.warn({ err, storagePath: t.storagePath }, "Failed to delete old target file");
            })
          )
      );
      await db.targetAsset.deleteMany({ where: { fillSessionId: id } });
    }

    const contentType = req.headers.get("content-type") ?? "";
    let targetAsset;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      const parsed = targetWebpageSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError("Invalid URL", parsed.error.flatten().fieldErrors);
      }

      const result = await inspectTarget("WEBPAGE", { url: parsed.data.url });

      targetAsset = await db.targetAsset.create({
        data: {
          fillSessionId: id,
          targetType: "WEBPAGE",
          url: parsed.data.url,
          detectedFields: toInputJson(result.fields),
          isSupported: result.isSupported,
          unsupportedReason: result.unsupportedReason ?? null,
          inspectedAt: new Date(),
        },
      });
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      const targetType = formData.get("targetType") as string;

      if (!file || !(file instanceof File)) {
        throw new ValidationError("No file provided", { file: ["File is required"] });
      }
      if (targetType !== "PDF" && targetType !== "DOCX") {
        throw new ValidationError("Invalid target type", {
          targetType: ["Must be PDF or DOCX"],
        });
      }

      const validation = validateTargetFile(
        { size: file.size, type: file.type, name: file.name },
        targetType
      );
      if (!validation.valid) {
        throw new ValidationError(validation.error!, { file: [validation.error!] });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const sanitized = sanitizeFileName(file.name);
      const storageKey = `sessions/${id}/targets/${Date.now()}-${sanitized}`;
      await storage.upload(storageKey, buffer, file.type);

      const result = await inspectTarget(targetType, { buffer });

      targetAsset = await db.targetAsset.create({
        data: {
          fillSessionId: id,
          targetType,
          fileName: file.name,
          storagePath: storageKey,
          detectedFields: toInputJson(result.fields),
          isSupported: result.isSupported,
          unsupportedReason: result.unsupportedReason ?? null,
          inspectedAt: new Date(),
        },
      });
    } else {
      throw new ValidationError("Invalid content type", {
        contentType: ["Expected application/json or multipart/form-data"],
      });
    }

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "TARGET_SET", currentStep: "TARGET" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "TARGET_SET",
          actor: "USER",
          payload: {
            targetType: targetAsset.targetType,
            fieldCount: (targetAsset.detectedFields as unknown[]).length,
            isSupported: targetAsset.isSupported,
            targetAssetId: targetAsset.id,
          },
        },
      }),
    ]);

    logger.info(
      { sessionId: id, targetAssetId: targetAsset.id, targetType: targetAsset.targetType },
      "Target asset created"
    );

    return NextResponse.json(toTargetResponse(targetAsset), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: { targetAssets: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const storage = getStorageAdapter();
    await Promise.all(
      fillSession.targetAssets
        .filter((t) => t.storagePath)
        .map((t) =>
          storage.delete(t.storagePath!).catch((err) => {
            logger.warn({ err, storagePath: t.storagePath }, "Failed to delete target file");
          })
        )
    );
    await db.targetAsset.deleteMany({ where: { fillSessionId: id } });

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "EXTRACTED", currentStep: "TARGET" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "TARGET_REMOVED",
          actor: "USER",
          payload: {},
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
