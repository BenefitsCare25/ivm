import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError } from "@/lib/errors";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();
    const userId = session.user.id;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
    const skip = (page - 1) * limit;

    const [fillSessions, portals] = await Promise.all([
      db.fillSession.findMany({ where: { userId }, select: { id: true } }),
      db.portal.findMany({ where: { userId }, select: { id: true } }),
    ]);

    const fillSessionIds = fillSessions.map((s) => s.id);
    let trackedItemIds: string[] = [];

    if (portals.length > 0) {
      const scrapeSessions = await db.scrapeSession.findMany({
        where: { portalId: { in: portals.map((p) => p.id) } },
        select: { id: true },
      });
      if (scrapeSessions.length > 0) {
        const items = await db.trackedItem.findMany({
          where: { scrapeSessionId: { in: scrapeSessions.map((s) => s.id) } },
          select: { id: true },
        });
        trackedItemIds = items.map((i) => i.id);
      }
    }

    const hasScope = fillSessionIds.length > 0 || trackedItemIds.length > 0;
    if (!hasScope) return NextResponse.json({ events: [], total: 0 });

    const where = {
      OR: [
        ...(fillSessionIds.length > 0 ? [{ fillSessionId: { in: fillSessionIds } }] : []),
        ...(trackedItemIds.length > 0 ? [{ trackedItemId: { in: trackedItemIds } }] : []),
      ],
    };

    const [events, total] = await Promise.all([
      db.validationResult.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.validationResult.count({ where }),
    ]);

    return NextResponse.json({ events, total });
  } catch (err) {
    return errorResponse(err);
  }
}
