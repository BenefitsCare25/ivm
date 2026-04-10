import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePortalScrape } from "@/lib/queue/portal-scrape-queue";
import { errorResponse, UnauthorizedError, NotFoundError, AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!portal) throw new NotFoundError("Portal");

    const body = await req.json().catch(() => ({}));
    const expectedDocumentTypeId = typeof body.expectedDocumentTypeId === "string" ? body.expectedDocumentTypeId : null;

    // Create scrape session
    const scrapeSession = await db.scrapeSession.create({
      data: {
        portalId: id,
        triggeredBy: "MANUAL",
        expectedDocumentTypeId,
      },
    });

    // Enqueue the scrape job
    const jobId = await enqueuePortalScrape({
      portalId: id,
      scrapeSessionId: scrapeSession.id,
      userId: session.user.id,
    });

    if (!jobId) {
      throw new AppError("Background job queue not available. Ensure Redis is running.", 503, "QUEUE_UNAVAILABLE");
    }

    logger.info({ portalId: id, scrapeSessionId: scrapeSession.id }, "Scrape triggered");

    return NextResponse.json(
      { scrapeSessionId: scrapeSession.id, jobId },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const sessions = await db.scrapeSession.findMany({
      where: { portalId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        triggeredBy: true,
        itemsFound: true,
        itemsProcessed: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    return NextResponse.json(sessions);
  } catch (err) {
    return errorResponse(err);
  }
}
