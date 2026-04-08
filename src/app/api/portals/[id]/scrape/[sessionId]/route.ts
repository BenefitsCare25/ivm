import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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
