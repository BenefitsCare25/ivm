import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueItemDetailBatch, getItemDetailQueue } from "@/lib/queue/item-detail-queue";
import { AppError, errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertAuthValid } from "@/lib/portal-auth";
import type { TrackedItemStatus } from "@/types/portal";
import { syncScrapeSessionProgress } from "@/lib/portal-session-lifecycle";
import { parsePortalAISelection } from "@/lib/ai/connected-models";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { assertCodexWorkerReady } from "@/lib/ai/codex-worker-health";

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
      select: { id: true, userId: true, authMethod: true, comparisonModel: true, credential: {
        select: { cookieData: true, cookieExpiresAt: true, encryptedUsername: true, encryptedPassword: true },
      }},
    });
    if (!portal) throw new NotFoundError("Portal");

    if (type !== "skip") {
      assertAuthValid(portal.credential);
    }

    const scrapeSession = await db.scrapeSession.findFirst({
      where: { id: sessionId, portalId: id },
      select: { id: true, claimConcurrency: true, status: true },
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

    // Reject a lost default connection before resetting claims or queueing work.
    const selection = parsePortalAISelection(portal.comparisonModel);
    const provider = await resolveProviderAndKey(session.user.id, selection?.provider);
    if (provider.provider === "codex") await assertCodexWorkerReady();
    if (!getItemDetailQueue()) throw new AppError("The processing queue is unavailable. Try again when the worker is ready.", 503, "QUEUE_UNAVAILABLE");

    const statusFilter: TrackedItemStatus[] =
      type === "failed"      ? ["ERROR"] :
      type === "unprocessed" ? ["DISCOVERED", "RETRYING"] :
      type === "documents"   ? ["REQUIRE_DOC"] :
                               ["ERROR", "DISCOVERED", "RETRYING"];
    // A running retry already owns a stable queue job and its attempt budget.
    if (scrapeSession.status === "RUNNING" || scrapeSession.status === "PENDING") {
      const retryIndex = statusFilter.indexOf("RETRYING");
      if (retryIndex >= 0) statusFilter.splice(retryIndex, 1);
    }

    // Reset to DISCOVERED so the worker treats them as fresh
    await db.trackedItem.updateMany({
      where: { scrapeSessionId: sessionId, status: { in: statusFilter } },
      data: { status: "DISCOVERED", errorMessage: null, aiRecoveryAttempts: 0, retryAt: null },
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

    // Reactivate before queue admission: an immediately picked-up job must not
    // see CANCELLED and complete without reviewing the claim.
    await db.scrapeSession.update({
      where: { id: sessionId },
      data: { status: "RUNNING", completedAt: null, authExpiredAt: null },
    });
    const count = await enqueueItemDetailBatch(
      items.map((item) => ({
        trackedItemId: item.id,
        portalId: item.scrapeSession.portalId,
        scrapeSessionId: sessionId,
        userId: item.scrapeSession.portal.userId,
        claimConcurrency: scrapeSession.claimConcurrency,
        resumeDownloaded: type !== "documents",
      })),
      { reprocess: true }
    );

    await syncScrapeSessionProgress(sessionId, "items-requeued");

    return NextResponse.json({ requeued: count });
  } catch (err) {
    return errorResponse(err);
  }
}
