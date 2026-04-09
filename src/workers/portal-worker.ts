import { Job } from "bullmq";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeListPage, goToNextPage } from "@/lib/playwright/scraper";
import { closeBrowser } from "@/lib/playwright/browser";
import {
  startPortalScrapeWorker,
  type PortalScrapeJobData,
  type PortalScrapeJobResult,
} from "@/lib/queue/portal-scrape-queue";
import { enqueueItemDetailBatch } from "@/lib/queue/item-detail-queue";
import type { ListSelectors } from "@/types/portal";

async function processPortalScrape(
  job: Job<PortalScrapeJobData>
): Promise<PortalScrapeJobResult> {
  const { portalId, scrapeSessionId, userId } = job.data;

  // For scheduled jobs, create a ScrapeSession if not provided
  let sessionId = scrapeSessionId;
  if (!sessionId) {
    const session = await db.scrapeSession.create({
      data: { portalId, triggeredBy: "SCHEDULED" },
    });
    sessionId = session.id;
  }

  await db.scrapeSession.update({
    where: { id: sessionId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const portal = await db.portal.findUniqueOrThrow({
      where: { id: portalId },
      include: { credential: true },
    });

    const listSelectors = portal.listSelectors as ListSelectors;

    // Authenticate and get browser context
    const { context, page } = await resolveAuth({
      credential: portal.credential,
      baseUrl: portal.baseUrl,
      listPageUrl: portal.listPageUrl,
    });

    try {
      // Navigate to list page if not already there
      const listUrl = portal.listPageUrl ?? portal.baseUrl;
      if (page.url() !== listUrl) {
        await page.goto(listUrl, { waitUntil: "networkidle", timeout: 30_000 });
      }

      // Scrape all pages
      const allRows = [];
      let pageNum = 1;

      do {
        logger.info({ portalId, pageNum }, "[worker] Scraping list page");
        const rows = await scrapeListPage(page, listSelectors);
        allRows.push(...rows);
        pageNum++;
      } while (await goToNextPage(page, listSelectors.paginationSelector));

      const limitedRows = portal.scrapeLimit ? allRows.slice(0, portal.scrapeLimit) : allRows;
      logger.info({ portalId, totalRows: allRows.length, limited: limitedRows.length }, "[worker] List scrape complete");

      // Create TrackedItem records in bulk
      await db.trackedItem.createMany({
        data: limitedRows.map((row) => ({
          scrapeSessionId: sessionId,
          portalItemId: row.portalItemId,
          listData: JSON.parse(JSON.stringify(row.fields)),
          detailPageUrl: row.detailUrl,
          status: "DISCOVERED" as const,
        })),
      });

      // Fetch created items for enqueueing detail jobs
      const trackedItems = await db.trackedItem.findMany({
        where: { scrapeSessionId: sessionId },
        select: { id: true, detailPageUrl: true },
      });

      // Update session item count
      await db.scrapeSession.update({
        where: { id: sessionId },
        data: { itemsFound: trackedItems.length },
      });

      // Enqueue detail processing jobs for items with detail URLs
      const itemsWithDetail = trackedItems
        .filter((item) => item.detailPageUrl)
        .map((item) => ({
          trackedItemId: item.id,
          portalId,
          userId,
        }));

      if (itemsWithDetail.length > 0) {
        await enqueueItemDetailBatch(itemsWithDetail);
      }

      await db.scrapeSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      return { status: "COMPLETED", itemsFound: limitedRows.length };
    } finally {
      await context.close();
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, portalId, sessionId }, "[worker] Portal scrape failed");

    await db.scrapeSession.update({
      where: { id: sessionId },
      data: { status: "FAILED", completedAt: new Date(), errorMessage },
    });

    return { status: "FAILED", itemsFound: 0, errorMessage };
  }
}

// Start the worker when this file is executed
const worker = startPortalScrapeWorker(processPortalScrape);

if (worker) {
  logger.info("[worker] Portal scrape worker started");
} else {
  logger.warn("[worker] Redis not available, portal scrape worker not started");
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (worker) await worker.close();
  await closeBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  if (worker) await worker.close();
  await closeBrowser();
  process.exit(0);
});
