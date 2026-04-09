import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, itemId } = await params;
    const url = new URL(req.url);
    const screenshotPath = url.searchParams.get("path");
    if (!screenshotPath) throw new ValidationError("Missing path parameter", {});

    // Verify ownership
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    // Verify path belongs to this item (prevent path traversal)
    if (!screenshotPath.startsWith(`portal-events/${itemId}/`)) {
      throw new ValidationError("Invalid screenshot path", {});
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(screenshotPath);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
