import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { analyzePageStructure } from "@/lib/ai/page-analysis";
import { resolveAuth } from "@/lib/playwright/auth";
import { scrapeListPage } from "@/lib/playwright/scraper";
import { capturePageScreenshot, captureSimplifiedHtml } from "@/lib/playwright/screenshot";
import {
  attachPageDiagnostics,
  type PageDiagnosticsCollector,
} from "@/lib/playwright/page-diagnostics";
import { AppError, errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      include: { credential: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const targetUrl = portal.listPageUrl ?? portal.baseUrl;

    // Attempt authenticated navigation; fall back to unauthenticated if no credentials yet
    let context, page;
    let pageDiagnostics: PageDiagnosticsCollector | undefined;
    const hasCreds = portal.credential?.cookieData || portal.credential?.encryptedUsername;

    if (hasCreds) {
      ({ context, page } = await resolveAuth({
        credential: portal.credential,
        baseUrl: portal.baseUrl,
        listPageUrl: portal.listPageUrl,
      }, {
        onPageCreated: (createdPage) => {
          pageDiagnostics = attachPageDiagnostics(createdPage);
        },
      }));
    } else {
      logger.info({ portalId: id }, "[analyze] No credentials — navigating unauthenticated");
      const { createBrowserContext } = await import("@/lib/playwright/browser");
      context = await createBrowserContext();
      page = await context.newPage();
      pageDiagnostics = attachPageDiagnostics(page);
    }

    try {
      if (page.url() !== targetUrl) {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
      }

      // Wait for SPA content to render — many portals load a shell first,
      // then fetch data asynchronously. Wait for body content to stabilize.
      await page.waitForFunction(
        () => {
          const body = document.body;
          if (!body) return false;
          // Wait until body has meaningful content (more than just a shell/spinner)
          const text = body.innerText.trim();
          const hasTable = !!document.querySelector("table, [role='grid'], [role='table']");
          const hasRows = document.querySelectorAll("tr, [role='row']").length > 1;
          const hasContent = text.length > 200 || hasTable || hasRows;
          return hasContent;
        },
        { timeout: 15_000 }
      ).catch(() => {
        // If content doesn't appear within 15s, proceed anyway — AI will handle a sparse page
        logger.warn({ portalId: id }, "[analyze] Timed out waiting for dynamic content");
      });

      // Extra settle time for any final async renders
      await page.waitForTimeout(2000);

      const actualUrl = page.url();
      const pageTitle = await page.title();
      logger.info({ portalId: id, targetUrl, actualUrl, pageTitle }, "[analyze] Page loaded");

      // Capture screenshot and HTML for AI analysis
      // The collector is normally attached before the first navigation through
      // resolveAuth. Keep a defensive fallback for future auth strategies.
      pageDiagnostics ??= attachPageDiagnostics(page);

      const [screenshot, htmlSnippet, browserDiagnostics, browserCookies] = await Promise.all([
        capturePageScreenshot(page),
        captureSimplifiedHtml(page),
        pageDiagnostics.snapshot(),
        context.cookies(),
      ]);

      const nowSeconds = Date.now() / 1000;
      const cookieDomains = [...new Set(browserCookies.map((cookie) => cookie.domain))].sort();

      logger.info(
        {
          portalId: id,
          authentication: {
            strategy: hasCreds ? "configured" : "none",
            cookieCount: browserCookies.length,
            cookieDomains,
            expiredCookieCount: browserCookies.filter(
              (cookie) => cookie.expires > 0 && cookie.expires <= nowSeconds
            ).length,
            sessionCookieCount: browserCookies.filter((cookie) => cookie.expires <= 0).length,
          },
          ...browserDiagnostics,
        },
        "[analyze] Browser diagnostics captured"
      );

      logger.info(
        { portalId: id, screenshotBytes: screenshot.length, htmlBytes: htmlSnippet.length },
        "[analyze] Captured page data"
      );

      // Resolve AI provider
      const { provider, apiKey, visionModel, baseURL, displayProvider } =
        await resolveProviderAndKey(session.user.id);

      logger.info(
        {
          portalId: id,
          provider,
          displayProvider,
          model: visionModel,
          customEndpointConfigured: Boolean(baseURL),
        },
        "[analyze] AI provider resolved"
      );

      // AI page analysis
      const analysis = await analyzePageStructure({
        url: targetUrl,
        screenshot,
        htmlSnippet,
        provider,
        apiKey,
        model: visionModel,
        baseURL,
      });

      // Test the AI's selector proposal against the same live DOM before it is
      // shown to the user or saved. Runtime row resolution supports relative,
      // independent page-level, and safe table-body fallback selectors.
      if (analysis.pageType === "list" && analysis.listSelectors.tableSelector) {
        let sampleRows: Awaited<ReturnType<typeof scrapeListPage>>;
        try {
          sampleRows = await scrapeListPage(page, analysis.listSelectors, {
            discoverDetailUrls: false,
          });
        } catch (cause) {
          const detail = cause instanceof Error
            ? cause.message.slice(0, 240)
            : "The proposed selectors could not be evaluated.";
          logger.warn(
            { err: cause, portalId: id },
            "[analyze] AI list selector validation failed",
          );
          throw new AppError(
            `AI analysis generated selectors that do not match the live page: ${detail} Run the analysis again or edit the proposed selectors.`,
            422,
            "AI_SELECTOR_VALIDATION_ERROR",
          );
        }
        const columnNames = (analysis.listSelectors.columns ?? []).map(
          (column) => column.name,
        );
        const populatedColumns = columnNames.filter((name) =>
          sampleRows.some((row) => Boolean(row.fields[name]?.trim())),
        );

        if (
          sampleRows.length > 0 &&
          columnNames.length > 0 &&
          populatedColumns.length === 0
        ) {
          throw new AppError(
            "AI analysis found table rows, but none of its column selectors matched. Run the analysis again or review the proposed selectors.",
            422,
            "AI_SELECTOR_VALIDATION_ERROR",
          );
        }

        logger.info(
          {
            portalId: id,
            matchedRows: sampleRows.length,
            configuredColumns: columnNames.length,
            populatedColumns: populatedColumns.length,
            emptyColumns: columnNames.filter(
              (name) => !populatedColumns.includes(name),
            ),
          },
          "[analyze] AI list selectors validated against live DOM",
        );
      }

      logger.info(
        {
          portalId: id,
          pageType: analysis.pageType,
          columns: analysis.listSelectors.columns?.length ?? 0,
          tableSelector: analysis.listSelectors.tableSelector ?? "(empty)",
          rowSelector: analysis.listSelectors.rowSelector ?? "(empty)",
          detailLinkSelector: analysis.listSelectors.detailLinkSelector ?? "(empty)",
          description: analysis.description,
          rawResponseSnippet: typeof analysis.rawResponse === "string"
            ? (analysis.rawResponse as string).slice(0, 300)
            : JSON.stringify(analysis.rawResponse).slice(0, 300),
        },
        "[analyze] Page analysis completed"
      );

      return NextResponse.json({
        pageType: analysis.pageType,
        description: analysis.description,
        listSelectors: analysis.listSelectors,
        detailSelectors: analysis.detailSelectors,
      });
    } finally {
      pageDiagnostics?.detach();
      await context.close();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
