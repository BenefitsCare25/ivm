import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError, errorResponse, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertAuthValid } from "@/lib/portal-auth";
import { resolveAuth } from "@/lib/playwright/auth";
import { isInsproClaimList, readBenefitYears } from "@/lib/playwright/benefit-year";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const { id } = await params;
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      include: { credential: true },
    });
    if (!portal) throw new NotFoundError("Portal");
    const listUrl = portal.listPageUrl ?? portal.baseUrl;
    if (!isInsproClaimList(listUrl)) return NextResponse.json({ years: [], selected: null });
    assertAuthValid(portal.credential);
    const { context, page } = await resolveAuth({ ...portal, portalId: portal.id });
    try {
      if (page.url() !== listUrl) await page.goto(listUrl, { waitUntil: "networkidle", timeout: 30_000 });
      return NextResponse.json(await readBenefitYears(page, listUrl), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : "Could not load benefit years. Try again.", 502, "BENEFIT_YEARS_UNAVAILABLE");
    } finally {
      await context.close();
    }
  } catch (error) {
    return errorResponse(error);
  }
}
