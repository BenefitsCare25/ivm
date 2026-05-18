import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { toSGTDateStr } from "@/lib/portal-metrics";

function sgtDayRange(dateParam: string | null): { start: Date; end: Date; dateStr: string } {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return {
      start: new Date(`${dateParam}T00:00:00+08:00`),
      end: new Date(`${dateParam}T23:59:59.999+08:00`),
      dateStr: dateParam,
    };
  }
  const dateStr = toSGTDateStr(new Date());
  return {
    start: new Date(`${dateStr}T00:00:00+08:00`),
    end: new Date(`${dateStr}T23:59:59.999+08:00`),
    dateStr,
  };
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { searchParams } = new URL(request.url);
    const { start, end, dateStr } = sgtDayRange(searchParams.get("date"));
    const todayStr = toSGTDateStr(new Date());
    const isToday = dateStr === todayStr;

    // For today: live session query (captures in-progress items)
    // For past dates: snapshot table (persists through retention cleanup)
    if (isToday) {
      return NextResponse.json(await buildLiveSummary(session.user.id, start, end, dateStr));
    } else {
      return NextResponse.json(await buildSnapshotSummary(session.user.id, dateStr));
    }
  } catch (err) {
    return errorResponse(err);
  }
}

async function buildLiveSummary(userId: string, start: Date, end: Date, dateStr: string) {
  const sessions = await db.scrapeSession.findMany({
    where: {
      portal: { userId },
      createdAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      portal: { select: { id: true, name: true, baseUrl: true } },
      trackedItems: {
        select: { status: true, _count: { select: { files: true } } },
      },
    },
  });

  const statusBreakdown: Record<string, number> = {};
  const portalMap = new Map<string, {
    portalId: string; name: string; baseUrl: string;
    sessions: number; items: number; files: number; statusCounts: Record<string, number>;
  }>();

  let totalItems = 0, totalFiles = 0;

  for (const s of sessions) {
    const pid = s.portal.id;
    if (!portalMap.has(pid)) {
      portalMap.set(pid, { portalId: pid, name: s.portal.name, baseUrl: s.portal.baseUrl, sessions: 0, items: 0, files: 0, statusCounts: {} });
    }
    const p = portalMap.get(pid)!;
    p.sessions++;
    for (const item of s.trackedItems) {
      totalItems++;
      p.items++;
      const fc = item._count.files;
      totalFiles += fc;
      p.files += fc;
      statusBreakdown[item.status] = (statusBreakdown[item.status] ?? 0) + 1;
      p.statusCounts[item.status] = (p.statusCounts[item.status] ?? 0) + 1;
    }
  }

  return {
    date: dateStr,
    source: "live",
    totals: {
      sessions: sessions.length,
      items: totalItems,
      flagged: statusBreakdown["FLAGGED"] ?? 0,
      errors: statusBreakdown["ERROR"] ?? 0,
      files: totalFiles,
    },
    statusBreakdown,
    byPortal: Array.from(portalMap.values()).map((p) => ({
      portalId: p.portalId,
      name: p.name,
      baseUrl: p.baseUrl,
      sessions: p.sessions,
      items: p.items,
      files: p.files,
      compared: p.statusCounts["COMPARED"] ?? 0,
      flagged: p.statusCounts["FLAGGED"] ?? 0,
      errors: p.statusCounts["ERROR"] ?? 0,
      skipped: p.statusCounts["SKIPPED"] ?? 0,
      verified: p.statusCounts["VERIFIED"] ?? 0,
      requireDoc: p.statusCounts["REQUIRE_DOC"] ?? 0,
    })).sort((a, b) => b.items - a.items),
  };
}

async function buildSnapshotSummary(userId: string, dateStr: string) {
  const rows = await db.portalDailyMetrics.findMany({
    where: { portal: { userId }, date: dateStr },
    include: { portal: { select: { id: true, name: true, baseUrl: true } } },
  });

  const statusBreakdown: Record<string, number> = {};
  let totalSessions = 0, totalItems = 0, totalFlagged = 0, totalErrors = 0, totalFiles = 0;

  const byPortal = rows.map((r) => {
    totalSessions += r.sessions;
    totalItems += r.items;
    totalFlagged += r.flagged;
    totalErrors += r.errors;
    totalFiles += r.files;

    statusBreakdown["COMPARED"]    = (statusBreakdown["COMPARED"]    ?? 0) + r.compared;
    statusBreakdown["FLAGGED"]     = (statusBreakdown["FLAGGED"]     ?? 0) + r.flagged;
    statusBreakdown["ERROR"]       = (statusBreakdown["ERROR"]       ?? 0) + r.errors;
    statusBreakdown["SKIPPED"]     = (statusBreakdown["SKIPPED"]     ?? 0) + r.skipped;
    statusBreakdown["VERIFIED"]    = (statusBreakdown["VERIFIED"]    ?? 0) + r.verified;
    statusBreakdown["REQUIRE_DOC"] = (statusBreakdown["REQUIRE_DOC"] ?? 0) + r.requireDoc;

    return {
      portalId: r.portalId,
      name: r.portal.name,
      baseUrl: r.portal.baseUrl,
      sessions: r.sessions,
      items: r.items,
      files: r.files,
      compared: r.compared,
      flagged: r.flagged,
      errors: r.errors,
      skipped: r.skipped,
      verified: r.verified,
      requireDoc: r.requireDoc,
    };
  }).sort((a, b) => b.items - a.items);

  // Strip zero-count statuses from breakdown
  for (const key of Object.keys(statusBreakdown)) {
    if (statusBreakdown[key] === 0) delete statusBreakdown[key];
  }

  return {
    date: dateStr,
    source: "snapshot",
    totals: { sessions: totalSessions, items: totalItems, flagged: totalFlagged, errors: totalErrors, files: totalFiles },
    statusBreakdown,
    byPortal,
  };
}
