import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateSessionSchema } from "@/lib/validations/session";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
        extractionResults: { select: { id: true, status: true, documentType: true, completedAt: true } },
        targetAssets: { select: { id: true, targetType: true, url: true, fileName: true, isSupported: true } },
        mappingSets: { select: { id: true, status: true, proposedAt: true } },
        fillActions: { select: { id: true, status: true } },
      },
    });

    if (!fillSession) throw new NotFoundError("Session", id);

    return NextResponse.json(fillSession);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSessionSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { count } = await db.fillSession.updateMany({
      where: { id, userId: session.user.id },
      data: parsed.data,
    });

    if (count === 0) throw new NotFoundError("Session", id);

    const updated = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const { count } = await db.fillSession.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (count === 0) throw new NotFoundError("Session", id);

    logger.info({ sessionId: id }, "Session deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
