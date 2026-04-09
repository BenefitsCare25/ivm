import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, itemId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const item = await db.trackedItem.findFirst({
      where: { id: itemId, scrapeSession: { portalId: id } },
      select: { id: true },
    });
    if (!item) throw new NotFoundError("Item");

    const events = await db.trackedItemEvent.findMany({
      where: { trackedItemId: itemId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        eventType: true,
        payload: true,
        screenshotPath: true,
        durationMs: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
