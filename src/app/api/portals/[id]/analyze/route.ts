import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { analyzePageStructure } from "@/lib/ai/page-analysis";
import { resolveAuth } from "@/lib/playwright/auth";
import { capturePageScreenshot, captureSimplifiedHtml } from "@/lib/playwright/screenshot";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
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

    // Authenticate and navigate
    const { context, page } = await resolveAuth({
      credential: portal.credential,
      baseUrl: portal.baseUrl,
      listPageUrl: portal.listPageUrl,
    });

    try {
      if (page.url() !== targetUrl) {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
      }

      // Capture screenshot and HTML for AI analysis
      const [screenshot, htmlSnippet] = await Promise.all([
        capturePageScreenshot(page),
        captureSimplifiedHtml(page),
      ]);

      // Resolve AI provider
      const { provider, apiKey } = await resolveProviderAndKey(session.user.id);

      // AI page analysis
      const analysis = await analyzePageStructure({
        url: targetUrl,
        screenshot,
        htmlSnippet,
        provider,
        apiKey,
      });

      logger.info(
        { portalId: id, pageType: analysis.pageType, columns: analysis.listSelectors.columns?.length },
        "Page analysis completed"
      );

      return NextResponse.json({
        pageType: analysis.pageType,
        description: analysis.description,
        listSelectors: analysis.listSelectors,
        detailSelectors: analysis.detailSelectors,
      });
    } finally {
      await context.close();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
