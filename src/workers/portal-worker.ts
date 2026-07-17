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
import type { ListSelectors, ScrapeFilters } from "@/types/portal";
import { filterBySubmittedDate } from "@/lib/portal-submitted-filter";

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
      portalId: portal.id,
    });

    try {
      // Navigate to list page if not already there
      const listUrl = portal.listPageUrl ?? portal.baseUrl;
      if (page.url() !== listUrl) {
        await page.goto(listUrl, { waitUntil: "networkidle", timeout: 30_000 });
      }

      // A date filter selects a subset that may live on any page, so we must
      // scrape every page before filtering — the raw-count early-stop below
      // would otherwise skip in-range rows on later pages.
      const hasDateFilter = Boolean(job.data.submittedFrom || job.data.submittedTo);

      // Scrape all pages
      const allRows = [];
      let pageNum = 1;

      do {
        logger.info({ portalId, pageNum }, "[worker] Scraping list page");
        const rows = await scrapeListPage(page, listSelectors);
        allRows.push(...rows);
        pageNum++;
        // Stop early if we've already collected enough items (skipped when a
        // date filter is active — the limit is applied after filtering instead).
        if (!hasDateFilter && portal.scrapeLimit && allRows.length >= portal.scrapeLimit) break;
      } while (await goToNextPage(
        page,
        listSelectors.paginationSelector,
        listSelectors.tableSelector,
        listSelectors.rowSelector
      ));

      // Apply scrape filters — exclude rows matching configured field values
      const filters = (portal.scrapeFilters ?? {}) as Partial<ScrapeFilters>;
      const excludeStatuses = new Set(
        (filters.excludeByStatus ?? []).map((s) => s.trim().toLowerCase())
      );
      const excludeClaimTypes = new Set(
        (filters.excludeByClaimType ?? []).map((s) => s.trim().toLowerCase())
      );
      const filteredRows = allRows.filter((row) => {
        const fields = row.fields as Record<string, string>;
        const statusVal = (fields["Status"] ?? "").trim().toLowerCase();
        if (excludeStatuses.size > 0 && excludeStatuses.has(statusVal)) return false;
        const claimTypeVal = (fields["Claim Type"] ?? "").trim().toLowerCase();
        if (excludeClaimTypes.size > 0 && excludeClaimTypes.has(claimTypeVal)) return false;
        return true;
      });

      // Per-run "Submitted On" date range — drop out-of-range rows before they
      // become TrackedItems (so they are never detail-scraped or compared).
      const submitted = filterBySubmittedDate(filteredRows, {
        from: job.data.submittedFrom,
        to: job.data.submittedTo,
      });
      if (job.data.submittedFrom || job.data.submittedTo) {
        logger.info(
          {
            portalId,
            from: job.data.submittedFrom,
            to: job.data.submittedTo,
            applied: submitted.applied,
            kept: submitted.kept.length,
            droppedOutOfRange: submitted.droppedOutOfRange,
            droppedNoDate: submitted.droppedNoDate,
          },
          submitted.applied
            ? "[worker] Submitted-on date filter applied"
            : "[worker] Submitted-on column not found — date filter skipped"
        );
      }
      const dateFilteredRows = submitted.kept;

      const limitedRows = portal.scrapeLimit ? dateFilteredRows.slice(0, portal.scrapeLimit) : dateFilteredRows;
      logger.info(
        {
          portalId,
          totalRows: allRows.length,
          afterStatusFilter: filteredRows.length,
          afterDateFilter: dateFilteredRows.length,
          limited: limitedRows.length,
        },
        "[worker] List scrape complete"
      );

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

      // Fetch created items for enqueueing detail jobs.
      // Order MUST match the session-items table display order
      // ([createdAt asc, id asc]) so jobs are enqueued — and FIFO-processed — in
      // the same top-to-bottom order the user sees. Without an explicit orderBy
      // Postgres returns arbitrary heap order and processing appears to jump rows.
      const trackedItems = await db.trackedItem.findMany({
        where: { scrapeSessionId: sessionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
