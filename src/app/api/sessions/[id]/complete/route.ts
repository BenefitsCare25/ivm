import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    if (fillSession.status !== "FILLED") {
      throw new ValidationError(
        "Session must be in FILLED status to complete."
      );
    }

    await Promise.all([
      db.fillSession.updateMany({
        where: { id, userId: session.user.id },
        data: { status: "COMPLETED", currentStep: "REVIEW" },
      }),
      db.auditEvent.create({
        data: {
          fillSessionId: id,
          eventType: "SESSION_COMPLETED",
          actor: session.user.id,
        },
      }),
    ]);

    logger.info({ sessionId: id }, "Session completed");

    return NextResponse.json({ status: "COMPLETED" });
  } catch (err) {
    return errorResponse(err);
  }
}
