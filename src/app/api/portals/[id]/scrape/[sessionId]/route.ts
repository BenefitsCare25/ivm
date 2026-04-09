import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemDetailQueue } from "@/lib/queue/item-detail-queue";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId } = await params;

    // Verify portal ownership
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      include: {
        _count: {
          select: { trackedItems: true },
        },
      },
    });
    if (!scrapeSession) throw new NotFoundError("Scrape session");

    // Get status breakdown
    const statusCounts = await db.trackedItem.groupBy({
      by: ["status"],
      where: { scrapeSessionId: sessionId },
      _count: { id: true },
    });

    return NextResponse.json({
      id: scrapeSession.id,
      status: scrapeSession.status,
      triggeredBy: scrapeSession.triggeredBy,
      itemsFound: scrapeSession.itemsFound,
      itemsProcessed: scrapeSession.itemsProcessed,
      startedAt: scrapeSession.startedAt,
      completedAt: scrapeSession.completedAt,
      errorMessage: scrapeSession.errorMessage,
      createdAt: scrapeSession.createdAt,
      totalItems: scrapeSession._count.trackedItems,
      statusBreakdown: Object.fromEntries(
        statusCounts.map((s) => [s.status, s._count.id])
      ),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/portals/[id]/scrape/[sessionId] — stop (cancel) the session
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      select: { id: true },
    });
    if (!scrapeSession) throw new NotFoundError("Session");

    // Remove queued BullMQ jobs for DISCOVERED items in this session
    const pendingItems = await db.trackedItem.findMany({
      where: { scrapeSessionId: sessionId, status: { in: ["DISCOVERED", "PROCESSING"] } },
      select: { id: true },
    });

    const queue = getItemDetailQueue();
    if (queue && pendingItems.length > 0) {
      await Promise.allSettled(
        pendingItems.map((item) => queue.remove(`item_${item.id}`))
      );
    }

    // Reset any PROCESSING items back to DISCOVERED (they're no longer actively running)
    await db.trackedItem.updateMany({
      where: { scrapeSessionId: sessionId, status: "PROCESSING" },
      data: { status: "DISCOVERED" },
    });

    // Mark session as CANCELLED
    await db.scrapeSession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    return NextResponse.json({ stopped: true, removed: pendingItems.length });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/portals/[id]/scrape/[sessionId] — delete session and all its data
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      select: { id: true },
    });
    if (!scrapeSession) throw new NotFoundError("Session");

    // Remove queued BullMQ jobs before deleting records
    const allItems = await db.trackedItem.findMany({
      where: { scrapeSessionId: sessionId },
      select: { id: true },
    });

    const queue = getItemDetailQueue();
    if (queue && allItems.length > 0) {
      await Promise.allSettled(
        allItems.map((item) => queue.remove(`item_${item.id}`))
      );
    }

    // Delete session — cascade removes TrackedItem, TrackedItemFile, ComparisonResult
    await db.scrapeSession.delete({ where: { id: sessionId } });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
