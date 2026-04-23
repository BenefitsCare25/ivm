import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

const CONTENT_TYPES: Record<string, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EXTENSIONS: Record<string, string> = {
  PDF: ".pdf",
  DOCX: ".docx",
};

export async function GET(
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
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) throw new NotFoundError("Target asset");
    if (!targetAsset.filledStoragePath) {
      throw new ValidationError(
        "No filled document available. Execute fill first."
      );
    }

    if (targetAsset.targetType === "WEBPAGE") {
      throw new ValidationError(
        "Webpage targets don't produce downloadable files."
      );
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(targetAsset.filledStoragePath);

    const ext = EXTENSIONS[targetAsset.targetType] ?? "";
    const baseName = targetAsset.fileName
      ? targetAsset.fileName.replace(/\.[^.]+$/, "")
      : "document";
    const rawName = `${baseName}-filled${ext}`;
    const fileName = rawName.replace(/["\\\r\n]/g, "_");

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          CONTENT_TYPES[targetAsset.targetType] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
