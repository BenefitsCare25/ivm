import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id: portalId, sessionId, itemId } = await params;

    const portal = await db.portal.findFirst({
      where: { id: portalId, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const item = await db.trackedItem.findFirst({
      where: { id: itemId, scrapeSession: { id: sessionId, portalId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundError("Item");

    const validations = await db.validationResult.findMany({
      where: { trackedItemId: itemId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(validations);
  } catch (err) {
    return errorResponse(err);
  }
}
