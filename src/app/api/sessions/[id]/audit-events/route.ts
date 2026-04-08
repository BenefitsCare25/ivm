import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { auditQuerySchema } from "@/lib/validations/audit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const url = new URL(req.url);
    const query = auditQuerySchema.parse({
      eventType: url.searchParams.get("eventType") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const where: Record<string, unknown> = { fillSessionId: id };
    if (query.eventType) where.eventType = query.eventType;

    const [events, total] = await Promise.all([
      db.auditEvent.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      db.auditEvent.count({ where }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: e.actor,
        timestamp: e.timestamp.toISOString(),
        payload: e.payload as Record<string, unknown>,
      })),
      total,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
