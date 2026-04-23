import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueItemDetailBatch } from "@/lib/queue/item-detail-queue";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import type { TrackedItemStatus } from "@/types/portal";

/**
 * POST /api/portals/[id]/scrape/[sessionId]/reprocess
 * Body: { type: "failed" | "unprocessed" | "all" }
 *
 * Re-queues items so the detail worker picks them up again:
 *   failed      — ERROR items only
 *   unprocessed — DISCOVERED items only
 *   all         — ERROR + DISCOVERED
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId } = await params;
    const { type = "all" } = await req.json().catch(() => ({}));

    // Ownership check FIRST — before any data modifications (covers skip branch too)
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, userId: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      select: { id: true },
    });
    if (!scrapeSession) throw new NotFoundError("Session");

    if (type === "skip") {
      const { count } = await db.trackedItem.updateMany({
        where: { scrapeSessionId: sessionId, status: "ERROR" },
        data: { status: "SKIPPED", errorMessage: null },
      });
      return NextResponse.json({ skipped: count });
    }

    const statusFilter: TrackedItemStatus[] =
      type === "failed"      ? ["ERROR"] :
      type === "unprocessed" ? ["DISCOVERED"] :
                               ["ERROR", "DISCOVERED"];

    // Reset to DISCOVERED so the worker treats them as fresh
    await db.trackedItem.updateMany({
      where: { scrapeSessionId: sessionId, status: { in: statusFilter } },
      data: { status: "DISCOVERED", errorMessage: null },
    });

    const items = await db.trackedItem.findMany({
      where: { scrapeSessionId: sessionId, status: "DISCOVERED" },
      select: {
        id: true,
        scrapeSession: {
          select: {
            portalId: true,
            portal: { select: { userId: true } },
          },
        },
      },
    });

    const count = await enqueueItemDetailBatch(
      items.map((item) => ({
        trackedItemId: item.id,
        portalId: item.scrapeSession.portalId,
        userId: item.scrapeSession.portal.userId,
      })),
      { reprocess: true }
    );

    // If session was stopped (CANCELLED), restore it to COMPLETED so the
    // UI reflects that the list scrape finished and detail processing is resuming.
    await db.scrapeSession.updateMany({
      where: { id: sessionId, status: "CANCELLED" },
      data: { status: "COMPLETED", completedAt: null },
    });

    return NextResponse.json({ requeued: count });
  } catch (err) {
    return errorResponse(err);
  }
}
