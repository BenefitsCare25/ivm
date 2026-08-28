import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueItemDetailBatch } from "@/lib/queue/item-detail-queue";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertAuthValid } from "@/lib/portal-auth";
import type { TrackedItemStatus } from "@/types/portal";
import { syncScrapeSessionProgress } from "@/lib/portal-session-lifecycle";

/**
 * POST /api/portals/[id]/scrape/[sessionId]/reprocess
 * Body: { type: "failed" | "unprocessed" | "documents" | "all" }
 *
 * Re-queues items so the detail worker picks them up again:
 *   failed      — ERROR items only
 *   unprocessed — DISCOVERED items only
 *   documents   — REQUIRE_DOC items only
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
    const payload: unknown = await req.json().catch(() => ({}));
    const requestedType = payload && typeof payload === "object" && "type" in payload
      ? (payload as { type?: unknown }).type
      : undefined;
    const type = requestedType ?? "all";
    if (typeof type !== "string" || !["failed", "unprocessed", "documents", "all", "skip"].includes(type)) {
      throw new ValidationError("Invalid reprocess type.");
    }

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
      await syncScrapeSessionProgress(sessionId, "failed-items-skipped");
      return NextResponse.json({ skipped: count });
    }

    const statusFilter: TrackedItemStatus[] =
      type === "failed"      ? ["ERROR"] :
      type === "unprocessed" ? ["DISCOVERED"] :
      type === "documents"   ? ["REQUIRE_DOC"] :
                               ["ERROR", "DISCOVERED"];

    // Reset to DISCOVERED so the worker treats them as fresh
    await db.trackedItem.updateMany({
      where: { scrapeSessionId: sessionId, status: { in: statusFilter } },
      data: { status: "DISCOVERED", errorMessage: null },
    });

    const items = await db.trackedItem.findMany({
      where: { scrapeSessionId: sessionId, status: "DISCOVERED" },
      // Match the table display order so retries process top-to-bottom.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

    await db.scrapeSession.update({
      where: { id: sessionId },
      data: {
        authExpiredAt: null,
      },
    });

    await db.scrapeSession.updateMany({
      where: { id: sessionId, status: "CANCELLED" },
      data: { status: "RUNNING", completedAt: null },
    });
    await syncScrapeSessionProgress(sessionId, "items-requeued");

    return NextResponse.json({ requeued: count });
  } catch (err) {
    return errorResponse(err);
  }
}
