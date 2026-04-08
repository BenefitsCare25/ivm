import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSessionSchema } from "@/lib/validations/session";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const fillSession = await db.fillSession.create({
      data: {
        userId: session.user.id,
        title: parsed.data.title,
        description: parsed.data.description || null,
      },
    });

    await db.auditEvent.create({
      data: {
        fillSessionId: fillSession.id,
        eventType: "SESSION_CREATED",
        actor: "USER",
        payload: { title: fillSession.title },
      },
    });

    logger.info({ sessionId: fillSession.id, userId: session.user.id }, "Session created");

    return NextResponse.json(
      { id: fillSession.id, title: fillSession.title },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const sessions = await db.fillSession.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        currentStep: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(sessions);
  } catch (err) {
    return errorResponse(err);
  }
}
