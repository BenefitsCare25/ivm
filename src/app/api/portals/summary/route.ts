import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { toSGTDateStr } from "@/lib/utils";

type ViewMode = "day" | "month" | "year";

function parsePeriod(view: ViewMode, raw: string | null): {
  period: string;
  dateRange: { gte: string; lte: string };
  isCurrentPeriod: boolean;
} {
  const today = toSGTDateStr(new Date());
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);

  if (view === "day") {
    const period = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
    return { period, dateRange: { gte: period, lte: period }, isCurrentPeriod: period === today };
  }

  if (view === "month") {
    const period = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentMonth;
    const [y, m] = period.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      period,
      dateRange: { gte: `${period}-01`, lte: `${period}-${String(lastDay).padStart(2, "0")}` },
      isCurrentPeriod: period === currentMonth,
    };
  }

  // year
  const period = raw && /^\d{4}$/.test(raw) ? raw : currentYear;
  return {
    period,
    dateRange: { gte: `${period}-01-01`, lte: `${period}-12-31` },
    isCurrentPeriod: period === currentYear,
  };
}

function toSGTInterval(dateRange: { gte: string; lte: string }) {
  return {
    start: new Date(`${dateRange.gte}T00:00:00+08:00`),
    end: new Date(`${dateRange.lte}T23:59:59.999+08:00`),
  };
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { searchParams } = new URL(request.url);
    const view = (searchParams.get("view") ?? "day") as ViewMode;
    const { period, dateRange, isCurrentPeriod } = parsePeriod(view, searchParams.get("period"));
    const userId = session.user.id;

    if (isCurrentPeriod) {
      const { start, end } = toSGTInterval(dateRange);

      // Day view: every session for today still exists (younger than retention) — read live.
      if (view === "day") {
        return NextResponse.json(await buildLiveSummary(userId, start, end, period, view));
      }

      // Month/year view of the current period spans days that retention cleanup may have
      // already purged from scrapeSession. Read those days from the persistent daily-metrics
      // snapshots, and overlay only today from live data (today's snapshot may be mid-scrape).
      const today = toSGTDateStr(new Date());
      const todayStart = new Date(`${today}T00:00:00+08:00`);
      const [snapshot, live] = await Promise.all([
        buildSnapshotSummary(
          userId,
          { portal: { userId }, date: { gte: dateRange.gte, lt: today } },
          period,
          view,
        ),
        buildLiveSummary(userId, todayStart, end, period, view),
      ]);
      return NextResponse.json(mergeSummaries(snapshot, live, period, view));
    }

    const where = view === "day"
      ? { portal: { userId }, date: period }
      : { portal: { userId }, date: dateRange };

    const snapshot = await buildSnapshotSummary(userId, where, period, view);
    if (snapshot.totals.items > 0) {
      return NextResponse.json(snapshot);
    }

    const { start, end } = toSGTInterval(dateRange);
    return NextResponse.json(await buildLiveSummary(userId, start, end, period, view));
  } catch (err) {
    return errorResponse(err);
  }
}

async function buildLiveSummary(userId: string, start: Date, end: Date, period: string, view: ViewMode) {
  const sessions = await db.scrapeSession.findMany({
    where: { portal: { userId }, createdAt: { gte: start, lte: end } },
    select: {
      id: true,
      portal: { select: { id: true, name: true, baseUrl: true } },
      trackedItems: { select: { status: true, _count: { select: { files: true } } } },
    },
  });

  const statusBreakdown: Record<string, number> = {};
  const portalMap = new Map<string, {
    portalId: string; name: string; baseUrl: string;
    sessions: number; items: number; files: number; statusCounts: Record<string, number>;
  }>();
  const NOT_PROCESSED = new Set(["DISCOVERED", "PROCESSING", "REQUIRE_DOC"]);
  let totalItems = 0, totalProcessed = 0, totalFiles = 0;

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
      if (!NOT_PROCESSED.has(item.status)) totalProcessed++;
      const fc = item._count.files;
      totalFiles += fc;
      p.files += fc;
      statusBreakdown[item.status] = (statusBreakdown[item.status] ?? 0) + 1;
      p.statusCounts[item.status] = (p.statusCounts[item.status] ?? 0) + 1;
    }
  }

  return {
    period,
    view,
    source: "live",
    totals: {
      sessions: sessions.length,
      items: totalItems,
      processed: totalProcessed,
      flagged: statusBreakdown["FLAGGED"] ?? 0,
      errors: statusBreakdown["ERROR"] ?? 0,
      files: totalFiles,
    },
    statusBreakdown,
    byPortal: Array.from(portalMap.values()).map((p) => ({
      portalId: p.portalId, name: p.name, baseUrl: p.baseUrl,
      sessions: p.sessions, items: p.items, files: p.files,
      compared:   p.statusCounts["COMPARED"]    ?? 0,
      flagged:    p.statusCounts["FLAGGED"]      ?? 0,
      errors:     p.statusCounts["ERROR"]        ?? 0,
      skipped:    p.statusCounts["SKIPPED"]      ?? 0,
      verified:   p.statusCounts["VERIFIED"]     ?? 0,
      requireDoc: p.statusCounts["REQUIRE_DOC"]  ?? 0,
      processing: p.statusCounts["PROCESSING"]   ?? 0,
      discovered: p.statusCounts["DISCOVERED"]   ?? 0,
    })).sort((a, b) => b.items - a.items),
  };
}

type SnapshotWhere = NonNullable<Parameters<typeof db.portalDailyMetrics.findMany>[0]>["where"];

async function buildSnapshotSummary(
  userId: string,
  where: SnapshotWhere,
  period: string,
  view: ViewMode,
) {
  const rows = await db.portalDailyMetrics.findMany({
    where,
    include: { portal: { select: { id: true, name: true, baseUrl: true } } },
  });

  const portalMap = new Map<string, {
    name: string; baseUrl: string;
    sessions: number; items: number; files: number;
    compared: number; flagged: number; errors: number;
    skipped: number; verified: number; requireDoc: number;
  }>();

  for (const r of rows) {
    if (!portalMap.has(r.portalId)) {
      portalMap.set(r.portalId, { name: r.portal.name, baseUrl: r.portal.baseUrl, sessions: 0, items: 0, files: 0, compared: 0, flagged: 0, errors: 0, skipped: 0, verified: 0, requireDoc: 0 });
    }
    const p = portalMap.get(r.portalId)!;
    p.sessions   += r.sessions;
    p.items      += r.items;
    p.files      += r.files;
    p.compared   += r.compared;
    p.flagged    += r.flagged;
    p.errors     += r.errors;
    p.skipped    += r.skipped;
    p.verified   += r.verified;
    p.requireDoc += r.requireDoc;
  }

  const byPortal = Array.from(portalMap.entries())
    .map(([portalId, p]) => ({ portalId, ...p }))
    .sort((a, b) => b.items - a.items);

  const sum = (fn: (p: typeof byPortal[number]) => number) => byPortal.reduce((s, p) => s + fn(p), 0);

  const statusBreakdown = Object.fromEntries(
    Object.entries({
      COMPARED:    sum((p) => p.compared),
      FLAGGED:     sum((p) => p.flagged),
      ERROR:       sum((p) => p.errors),
      SKIPPED:     sum((p) => p.skipped),
      VERIFIED:    sum((p) => p.verified),
      REQUIRE_DOC: sum((p) => p.requireDoc),
    }).filter(([, v]) => v > 0)
  );

  return {
    period,
    view,
    source: "snapshot",
    totals: {
      sessions: sum((p) => p.sessions),
      items:    sum((p) => p.items),
      processed: sum((p) => p.compared + p.verified + p.flagged + p.errors + p.skipped),
      flagged:  sum((p) => p.flagged),
      errors:   sum((p) => p.errors),
      files:    sum((p) => p.files),
    },
    statusBreakdown,
    byPortal,
  };
}

const PORTAL_NUMERIC_FIELDS = [
  "sessions", "items", "files", "compared", "flagged",
  "errors", "skipped", "verified", "requireDoc", "processing", "discovered",
] as const;

type PortalRow = { portalId: string; name: string; baseUrl: string } & Record<
  (typeof PORTAL_NUMERIC_FIELDS)[number], number
>;
type LooseSummary = {
  byPortal: Array<
    { portalId: string; name: string; baseUrl: string } &
      Partial<Record<(typeof PORTAL_NUMERIC_FIELDS)[number], number>>
  >;
};

function normalizePortalRow(p: LooseSummary["byPortal"][number]): PortalRow {
  const row = { portalId: p.portalId, name: p.name, baseUrl: p.baseUrl } as PortalRow;
  for (const f of PORTAL_NUMERIC_FIELDS) {
    row[f] = p[f] ?? 0;
  }
  return row;
}

// Combine snapshot (purged historical days) with live (today) for the current month/year view.
// Date ranges are disjoint — snapshot covers [start, today), live covers today — so summing never double-counts.
function mergeSummaries(snapshot: LooseSummary, live: LooseSummary, period: string, view: ViewMode) {
  const map = new Map<string, PortalRow>();
  for (const p of [...snapshot.byPortal, ...live.byPortal]) {
    const existing = map.get(p.portalId);
    if (!existing) {
      map.set(p.portalId, normalizePortalRow(p));
      continue;
    }
    for (const f of PORTAL_NUMERIC_FIELDS) {
      existing[f] += p[f] ?? 0;
    }
  }

  const byPortal = Array.from(map.values()).sort((a, b) => b.items - a.items);
  const sum = (fn: (p: PortalRow) => number) => byPortal.reduce((s, p) => s + fn(p), 0);

  const statusBreakdown = Object.fromEntries(
    Object.entries({
      COMPARED:    sum((p) => p.compared),
      FLAGGED:     sum((p) => p.flagged),
      ERROR:       sum((p) => p.errors),
      SKIPPED:     sum((p) => p.skipped),
      VERIFIED:    sum((p) => p.verified),
      REQUIRE_DOC: sum((p) => p.requireDoc),
      PROCESSING:  sum((p) => p.processing),
      DISCOVERED:  sum((p) => p.discovered),
    }).filter(([, v]) => v > 0)
  );

  return {
    period,
    view,
    source: "snapshot+live",
    totals: {
      sessions:  sum((p) => p.sessions),
      items:     sum((p) => p.items),
      processed: sum((p) => p.compared + p.verified + p.flagged + p.errors + p.skipped),
      flagged:   sum((p) => p.flagged),
      errors:    sum((p) => p.errors),
      files:     sum((p) => p.files),
    },
    statusBreakdown,
    byPortal,
  };
}
