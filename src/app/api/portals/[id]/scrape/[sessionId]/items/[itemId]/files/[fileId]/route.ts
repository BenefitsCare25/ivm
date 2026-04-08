import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string; fileId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, fileId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const file = await db.trackedItemFile.findFirst({
      where: { id: fileId },
      include: {
        trackedItem: {
          select: { scrapeSessionId: true, scrapeSession: { select: { portalId: true } } },
        },
      },
    });

    if (!file || file.trackedItem.scrapeSession.portalId !== id) {
      throw new NotFoundError("File");
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(file.storagePath);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${file.fileName}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
