import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueItemDetailBatch } from "@/lib/queue/item-detail-queue";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { assertAuthValid } from "@/lib/portal-auth";
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

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, userId: true, authMethod: true, credential: {
        select: { cookieData: true, cookieExpiresAt: true, encryptedUsername: true, encryptedPassword: true },
      }},
    });
    if (!portal) throw new NotFoundError("Portal");

    if (type !== "skip") {
      assertAuthValid(portal.credential);
    }

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

    // Count ERROR items being reset — they were already counted in itemsProcessed when they failed,
    // so we must decrement to avoid double-counting when the retry completes.
    const errorItemCount = statusFilter.includes("ERROR")
      ? await db.trackedItem.count({ where: { scrapeSessionId: sessionId, status: "ERROR" } })
      : 0;

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

    // Clear completedAt so the session page's isActive check enables auto-refresh.
    // Decrement itemsProcessed for ERROR items that were already counted on first failure.
    await db.scrapeSession.update({
      where: { id: sessionId },
      data: {
        completedAt: null,
        ...(errorItemCount > 0 ? { itemsProcessed: { decrement: errorItemCount } } : {}),
      },
    });

    // Restore CANCELLED sessions to COMPLETED so the UI shows the list scrape is done.
    await db.scrapeSession.updateMany({
      where: { id: sessionId, status: "CANCELLED" },
      data: { status: "COMPLETED" },
    });

    return NextResponse.json({ requeued: count });
  } catch (err) {
    return errorResponse(err);
  }
}
