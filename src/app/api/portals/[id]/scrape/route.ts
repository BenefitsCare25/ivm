import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePortalScrape } from "@/lib/queue/portal-scrape-queue";
import { errorResponse, UnauthorizedError, NotFoundError, AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { startScrapeSchema } from "@/lib/validations/portal";
import { assertAuthValid } from "@/lib/portal-auth";
import { findSubmittedKey } from "@/lib/portal-submitted-filter";
import type { ListSelectors } from "@/types/portal";

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
      select: { id: true, listSelectors: true, credential: {
        select: { cookieData: true, cookieExpiresAt: true, encryptedUsername: true, encryptedPassword: true },
      }},
    });
    if (!portal) throw new NotFoundError("Portal");

    assertAuthValid(portal.credential);

    const body = startScrapeSchema.parse(await req.json().catch(() => ({})));
    const acceptableDocumentTypeIds = body.acceptableDocumentTypeIds ?? [];

    // Pre-flight: a "Submitted On" date filter only works if the portal's list
    // selectors capture a submitted-date column. Reject up front (immediate UI
    // feedback) instead of silently scraping everything at worker time.
    if (body.submittedFrom || body.submittedTo) {
      const listSelectors = (portal.listSelectors ?? {}) as ListSelectors;
      const columnFields = Object.fromEntries(
        (listSelectors.columns ?? []).map((c) => [c.name, ""])
      );
      if (!findSubmittedKey(columnFields)) {
        throw new ValidationError(
          "This portal has no 'Submitted On' date column configured, so the date filter can't be applied. Add a submitted-date column in the portal's list selectors, or clear the date filter."
        );
      }
    }

    // Create scrape session
    const scrapeSession = await db.scrapeSession.create({
      data: {
        portalId: id,
        triggeredBy: "MANUAL",
        acceptableDocumentTypeIds,
        submittedFrom: body.submittedFrom ? new Date(body.submittedFrom) : null,
        submittedTo: body.submittedTo ? new Date(body.submittedTo) : null,
      },
    });

    // Enqueue the scrape job
    const jobId = await enqueuePortalScrape({
      portalId: id,
      scrapeSessionId: scrapeSession.id,
      userId: session.user.id,
      submittedFrom: body.submittedFrom,
      submittedTo: body.submittedTo,
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
