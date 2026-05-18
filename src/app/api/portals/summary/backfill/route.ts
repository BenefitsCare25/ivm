import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { snapshotPortalDay, toSGTDateStr } from "@/lib/portal-metrics";

// POST /api/portals/summary/backfill
// Backfills PortalDailyMetrics from all existing sessions for the authenticated user.
// Safe to call multiple times (upsert semantics). Run once after deploying this feature.
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const sessions = await db.scrapeSession.findMany({
      where: { portal: { userId: session.user.id } },
      select: { portalId: true, createdAt: true },
    });

    const pairs = new Set<string>();
    for (const s of sessions) {
      pairs.add(`${s.portalId}:${toSGTDateStr(s.createdAt)}`);
    }

    let days = 0;
    const portalsSeen = new Set<string>();
    for (const key of pairs) {
      const [portalId, date] = key.split(":");
      await snapshotPortalDay(portalId, date);
      portalsSeen.add(portalId);
      days++;
    }

    return NextResponse.json({ ok: true, days, portals: portalsSeen.size });
  } catch (err) {
    return errorResponse(err);
  }
}
