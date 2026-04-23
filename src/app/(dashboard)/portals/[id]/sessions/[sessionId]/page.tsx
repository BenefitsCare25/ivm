export const dynamic = "force-dynamic";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

const COMPLETED_STATUSES = new Set(["COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED", "REQUIRE_DOC"]);

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { TrackedItemsTable } from "@/components/portals/tracked-items-table";
import { ScrapeStatusBadge, ITEM_STATUS_COLORS } from "@/components/portals/portal-status-badge";
import { AutoRefresh } from "@/components/portals/auto-refresh";
import { SessionActions } from "@/components/portals/session-actions";
import { FWA_PRIORITY } from "@/types/portal";
import type { ScrapeSessionStatus, FieldComparison, DiagnosisAssessment } from "@/types/portal";


export default async function SessionItemsPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const session = await requireAuth();
  const { id, sessionId } = await params;

  const portal = await db.portal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!portal) notFound();

  const scrapeSession = await db.scrapeSession.findFirst({
    where: { id: sessionId, portalId: id },
    include: {
      trackedItems: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 50,
        select: {
          id: true,
          portalItemId: true,
          status: true,
          listData: true,
          detailData: true,
          detailPageUrl: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          files: {
            select: { id: true, fileName: true, mimeType: true },
            take: 10,
          },
          comparisonResult: {
            select: {
              matchCount: true,
              mismatchCount: true,
              summary: true,
              fieldComparisons: true,
              diagnosisAssessment: true,
            },
          },
        },
      },
      _count: {
        select: { trackedItems: true },
      },
    },
  });
  if (!scrapeSession) notFound();

  // Fetch all FWA validation results per item
  const itemIds = scrapeSession.trackedItems.map((i) => i.id);
  const fwaResults = itemIds.length > 0
    ? await db.validationResult.findMany({
        where: {
          trackedItemId: { in: itemIds },
          ruleType: { in: ["TAMPERING", "DUPLICATE", "DOC_TYPE_MATCH", "BUSINESS_RULE", "REQUIRED_DOCUMENT", "CURRENCY_CONVERSION"] },
        },
        select: { id: true, trackedItemId: true, ruleType: true, status: true, message: true, metadata: true },
      })
    : [];

  // Build per-item arrays of all FWA alerts + worst signal for table badge
  const fwaByItem = new Map<string, { ruleType: string; status: string; message: string }>();
  const fwaAlertsByItem = new Map<string, { id: string; ruleType: string; status: string; message: string; metadata?: Record<string, unknown> | null }[]>();
  for (const r of fwaResults) {
    if (!r.trackedItemId) continue;
    // All alerts array
    const arr = fwaAlertsByItem.get(r.trackedItemId) ?? [];
    arr.push({ id: r.id, ruleType: r.ruleType, status: r.status, message: r.message, metadata: r.metadata as Record<string, unknown> | null });
    fwaAlertsByItem.set(r.trackedItemId, arr);
    // Worst signal for table badge
    const existing = fwaByItem.get(r.trackedItemId);
    const newScore = (r.status === "FAIL" ? 100 : 0) + (FWA_PRIORITY[r.ruleType] ?? 0);
    const exScore = existing
      ? (existing.status === "FAIL" ? 100 : 0) + (FWA_PRIORITY[existing.ruleType] ?? 0)
      : -1;
    if (newScore > exScore) fwaByItem.set(r.trackedItemId, { ruleType: r.ruleType, status: r.status, message: r.message });
  }

  const statusCounts = await db.trackedItem.groupBy({
    by: ["status"],
    where: { scrapeSessionId: sessionId },
    _count: { id: true },
  });

  const breakdown = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count.id])
  );

  // Only auto-refresh when the worker is actively running jobs.
  // DISCOVERED items on a COMPLETED/CANCELLED session won't self-start —
  // the user must click "Continue" to re-enqueue them.
  const isActive =
    scrapeSession.status === "RUNNING" ||
    scrapeSession.status === "PENDING" ||
    (breakdown["PROCESSING"] ?? 0) > 0;

  const processingCount = (breakdown["PROCESSING"] ?? 0);
  const discoveredCount = (breakdown["DISCOVERED"] ?? 0);
  let displayStatus = scrapeSession.status as ScrapeSessionStatus;
  if (scrapeSession.status === "COMPLETED") {
    if (processingCount > 0) displayStatus = "RUNNING";
    else if (discoveredCount > 0) displayStatus = "PENDING";
  }

  const statusOrder = ["COMPARED", "FLAGGED", "VERIFIED", "REQUIRE_DOC", "SKIPPED", "ERROR", "PROCESSING", "DISCOVERED"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portals/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {portal.name}
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                Scrape Session
              </h1>
              <ScrapeStatusBadge status={displayStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              {scrapeSession._count.trackedItems} items found &middot;{" "}
              {(breakdown["COMPARED"] ?? 0) + (breakdown["FLAGGED"] ?? 0) + (breakdown["VERIFIED"] ?? 0) + (breakdown["ERROR"] ?? 0) + (breakdown["SKIPPED"] ?? 0)} processed
              {scrapeSession.startedAt && (
                <>
                  {" "}&middot;{" "}
                  {scrapeSession.completedAt
                    ? formatDuration(scrapeSession.completedAt.getTime() - scrapeSession.startedAt.getTime())
                    : "Running…"}
                </>
              )}
            </p>
          </div>
        </div>
        {isActive && <AutoRefresh />}
      </div>

      {/* Session error */}
      {scrapeSession.errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-status-error mt-0.5" />
          <div>
            <p className="text-sm font-medium text-status-error">Session error</p>
            <p className="text-xs text-status-error/80 mt-0.5">{scrapeSession.errorMessage}</p>
          </div>
        </div>
      )}

      {/* Progress + actions */}
      <SessionActions
        portalId={id}
        sessionId={sessionId}
        counts={{
          COMPARED:    breakdown["COMPARED"]    ?? 0,
          FLAGGED:     breakdown["FLAGGED"]     ?? 0,
          ERROR:       breakdown["ERROR"]       ?? 0,
          PROCESSING:  breakdown["PROCESSING"]  ?? 0,
          DISCOVERED:  breakdown["DISCOVERED"]  ?? 0,
          SKIPPED:     breakdown["SKIPPED"]     ?? 0,
          VERIFIED:    breakdown["VERIFIED"]    ?? 0,
          REQUIRE_DOC: breakdown["REQUIRE_DOC"] ?? 0,
        }}
        sessionStatus={scrapeSession.status}
      />

      {/* Status breakdown pills */}
      <div className="flex flex-wrap gap-2">
        {statusOrder
          .filter((st) => (breakdown[st] ?? 0) > 0)
          .map((status) => (
            <div
              key={status}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${ITEM_STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}
            >
              <span>{breakdown[status]}</span>
              <span className="opacity-70">{status}</span>
            </div>
          ))}
      </div>

      <TrackedItemsTable
        items={scrapeSession.trackedItems.map((item) => ({
          id: item.id,
          portalItemId: item.portalItemId,
          status: item.status,
          listData: (item.listData as Record<string, string>) ?? {},
          detailData: (item.detailData as Record<string, string>) ?? null,
          detailUrl: item.detailPageUrl,
          errorMessage: item.errorMessage,
          files: item.files,
          comparisonResult: item.comparisonResult
            ? {
                matchCount: item.comparisonResult.matchCount,
                mismatchCount: item.comparisonResult.mismatchCount,
                summary: item.comparisonResult.summary,
                fieldComparisons: item.comparisonResult.fieldComparisons as unknown as FieldComparison[],
                diagnosisAssessment: (item.comparisonResult.diagnosisAssessment as unknown as DiagnosisAssessment) ?? null,
              }
            : null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          runtime: COMPLETED_STATUSES.has(item.status)
            ? formatDuration(item.updatedAt.getTime() - item.createdAt.getTime())
            : item.status === "PROCESSING" ? "Running…" : null,
          fwaAlert: fwaByItem.get(item.id) ?? null,
          fwaAlerts: fwaAlertsByItem.get(item.id) ?? [],
        }))}
        portalId={id}
        sessionId={sessionId}
      />
    </div>
  );
}
