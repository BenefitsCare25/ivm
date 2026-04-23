import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateTrackedItemSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId, itemId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const item = await db.trackedItem.findFirst({
      where: { id: itemId, scrapeSession: { id: sessionId, portalId: id } },
      include: {
        files: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            downloadedAt: true,
          },
        },
        comparisonResult: {
          select: {
            id: true,
            matchCount: true,
            mismatchCount: true,
            summary: true,
            fieldComparisons: true,
            completedAt: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundError("Tracked item");

    return NextResponse.json(item);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, sessionId, itemId } = await params;
    const body = await req.json();
    const parsed = updateTrackedItemSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const updated = await db.trackedItem.updateMany({
      where: { id: itemId, scrapeSession: { id: sessionId, portalId: id } },
      data: parsed.data,
    });

    if (updated.count === 0) throw new NotFoundError("Tracked item");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
