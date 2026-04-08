import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPortalSchema } from "@/lib/validations/portal";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createPortalSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        authMethod: parsed.data.authMethod,
        listPageUrl: parsed.data.listPageUrl ?? null,
      },
    });

    logger.info({ portalId: portal.id, userId: session.user.id }, "Portal created");

    return NextResponse.json(
      { id: portal.id, name: portal.name, baseUrl: portal.baseUrl },
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

    const portals = await db.portal.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        scrapeSessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, createdAt: true, itemsFound: true },
        },
        _count: { select: { scrapeSessions: true } },
      },
    });

    const result = portals.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      authMethod: p.authMethod,
      scheduleEnabled: p.scheduleEnabled,
      scheduleCron: p.scheduleCron,
      lastScrapeStatus: p.scrapeSessions[0]?.status ?? null,
      lastScrapeAt: p.scrapeSessions[0]?.createdAt ?? null,
      totalSessions: p._count.scrapeSessions,
      createdAt: p.createdAt,
    }));

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
