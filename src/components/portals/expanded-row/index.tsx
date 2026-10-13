"use client";

import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, XCircle, Loader2, Clock, AlertTriangle, Info } from "lucide-react";
import { PortalDetailsColumn } from "./portal-details-column";
import { ComparisonColumn } from "./comparison-column";
import { DocumentViewerColumn } from "./document-viewer-column";
import type { TrackedItemStatus, ItemFile, ComparisonSummary, ValidationAlert, ItemEventSummary, ItemEventType } from "@/types/portal";
import { EVENT_TYPE_LABELS, EVENT_SEVERITY } from "@/types/portal";
import { getClaimActivity, isActiveClaimStatus } from "@/lib/claim-processing";

interface ExpandedPanelItem {
  id: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  errorMessage: string | null;
  aiRecoveryAttempts?: number;
  retryAt?: string | null;
  processingPaused?: boolean;
  files: ItemFile[];
  comparisonResult: ComparisonSummary | null;
  fwaAlerts: ValidationAlert[];
}

interface ExpandedPanelProps {
  item: ExpandedPanelItem;
  portalId: string;
  sessionId: string;
  columnCount: number;
}

// ─── Inline event feed for PROCESSING/DISCOVERED items ───────────────────────

function ProcessingFeed({
  portalId,
  sessionId,
  itemId,
  itemStatus,
  fileCount,
  paused,
}: {
  portalId: string;
  sessionId: string;
  itemId: string;
  itemStatus: TrackedItemStatus;
  fileCount: number;
  paused?: boolean;
}) {
  const [events, setEvents] = useState<ItemEventSummary[]>([]);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const controller = new AbortController();
    setEvents([]);

    async function fetchEvents() {
      if (fetching) return;
      fetching = true;
      try {
        const res = await fetch(
          `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events`,
          { signal: controller.signal },
        );
        if (!res.ok || !active) return;
        const data = (await res.json()) as { events: ItemEventSummary[] };
        if (active) setEvents(data.events ?? []);
      } catch {
        // non-fatal
      } finally {
        fetching = false;
      }
    }

    fetchEvents();
    const isActive = !paused && isActiveClaimStatus(itemStatus);
    const interval = isActive ? setInterval(fetchEvents, 3000) : undefined;

    return () => {
      active = false;
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [portalId, sessionId, itemId, itemStatus, paused]);

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Waiting for activity…</p>
    );
  }

  // Show last 8 events, latest first
  const recent = [...events].reverse().slice(0, 8);
  const activity = getClaimActivity(events, itemStatus);
  const { done: extractDone, started: extractStart, truncated, failed: extractFail } = activity;

  return (
    <div className="space-y-2">
      {/* Progress summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {extractStart > 0 && (
          <span className="text-muted-foreground">
            Files:{" "}
            <span className="font-medium text-foreground">
              {extractDone}/{Math.max(fileCount, extractStart)}
            </span>{" "}
            extracted
          </span>
        )}
        {truncated > 0 && (
          <span className="flex items-center gap-1 text-amber-500 font-medium">
            <AlertTriangle className="h-3 w-3" />
            {truncated} truncated
          </span>
        )}
        {extractFail > 0 && (
          <span className="flex items-center gap-1 text-red-500 font-medium">
            <AlertCircle className="h-3 w-3" />
            {extractFail} failed
          </span>
        )}
        {isActiveClaimStatus(itemStatus) && <span className="text-muted-foreground">Review incomplete</span>}
        {activity.attempt && <span className="text-muted-foreground">Attempt {activity.attempt} of 3</span>}
      </div>

      {/* Recent events list */}
      <div className="space-y-0.5">
        {recent.map((evt) => {
          const severity = EVENT_SEVERITY[evt.eventType as ItemEventType] ?? "info";
          const label = EVENT_TYPE_LABELS[evt.eventType as ItemEventType] ?? evt.eventType;
          const fileName = evt.payload.fileName as string | undefined;
          const eventMessage = evt.payload.errorMessage as string | undefined;

          const Icon =
            severity === "error"
              ? AlertCircle
              : severity === "warning"
              ? AlertTriangle
              : severity === "success"
              ? CheckCircle2
              : Info;

          const iconCls =
            severity === "error"
              ? "text-red-500"
              : severity === "warning"
              ? "text-amber-500"
              : severity === "success"
              ? "text-emerald-500"
              : "text-muted-foreground/50";

          const timePart = new Date(evt.createdAt).toLocaleTimeString("en-SG", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });

          return (
            <div key={evt.id} className="flex items-center gap-1.5 min-w-0">
              <Icon className={`h-3 w-3 shrink-0 ${iconCls}`} />
              <span className={`text-xs truncate ${severity === "error" ? "text-red-400" : severity === "warning" ? "text-amber-400" : "text-foreground/80"}`}>
                {label}
                {eventMessage && <span className="ml-1">— {eventMessage}</span>}
                {fileName && (
                  <span className="text-muted-foreground/60 ml-1">— {fileName}</span>
                )}
              </span>
              {evt.durationMs != null && (
                <span className="text-[10px] text-muted-foreground/40 shrink-0">
                  {evt.durationMs < 1000 ? `${evt.durationMs}ms` : `${(evt.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/30 shrink-0">{timePart}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; label: string; cls: string }> = {
  COMPARED:  { icon: CheckCircle2, label: "Processed",    cls: "text-status-success" },
  FLAGGED:   { icon: CheckCircle2, label: "Processed",    cls: "text-status-success" },
  VERIFIED:  { icon: CheckCircle2, label: "Verified",     cls: "text-status-success" },
  ERROR:     { icon: XCircle,      label: "Failed",       cls: "text-status-error" },
  PROCESSING:{ icon: Loader2,      label: "Processing...",cls: "text-blue-500" },
  DISCOVERED:{ icon: Clock,        label: "Pending",      cls: "text-muted-foreground" },
  RETRYING:  { icon: Clock,        label: "Retry queued", cls: "text-status-warning" },
  SKIPPED:   { icon: Clock,        label: "Skipped",      cls: "text-muted-foreground" },
};

export function ExpandedPanel({ item, portalId, sessionId, columnCount }: ExpandedPanelProps) {
  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.DISCOVERED;
  const StatusIcon = cfg.icon;

  const showLiveFeed = isActiveClaimStatus(item.status);
  const showEventHistory = item.status === "ERROR" && !item.comparisonResult;
  const showDetailColumns = !showLiveFeed && !showEventHistory;

  return (
    <tr>
      <td colSpan={columnCount} className="p-0">
        <div className="border-t border-border bg-muted/60 px-5 py-4 space-y-4">

          <div className="flex flex-wrap items-start gap-2" role="status">
            <StatusIcon
              className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cfg.cls} ${
                item.status === "PROCESSING" ? "animate-spin" : ""
              }`}
            />
            <span className={`text-xs font-medium ${cfg.cls}`}>{item.processingPaused && showLiveFeed && item.status !== "PROCESSING" ? "Review paused" : cfg.label}</span>
            {!item.processingPaused && (item.status === "ERROR" || showLiveFeed) && item.errorMessage && (
              <span className={`text-xs ${item.status === "ERROR" ? "text-status-error" : "text-foreground"}`}>
                &mdash; {item.errorMessage}
              </span>
            )}
          </div>
          {item.processingPaused && showLiveFeed && (
            <p className="text-xs text-foreground">This session is stopped. No final result yet. Downloaded documents are preserved; use Continue unprocessed to resume.</p>
          )}
          {!item.processingPaused && item.status === "RETRYING" && (
            <p className="text-xs text-foreground">
              {item.aiRecoveryAttempts ? <>Next attempt: {item.aiRecoveryAttempts + 1} of 3. </> : null}
              {item.retryAt && <>Eligible after {new Date(item.retryAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. </>}
              Waiting for a free worker and AI recovery. No final result yet.
            </p>
          )}

          {showLiveFeed && (
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Live Activity
              </p>
              <ProcessingFeed
                portalId={portalId}
                sessionId={sessionId}
                itemId={item.id}
                itemStatus={item.status}
                fileCount={item.files.length}
                paused={item.processingPaused}
              />
            </div>
          )}

          {showEventHistory && (
            <div className="rounded-md border border-status-error/20 bg-status-error/5 px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-status-error/60">
                Activity Log — what happened before the failure
              </p>
              <ProcessingFeed
                portalId={portalId}
                sessionId={sessionId}
                itemId={item.id}
                itemStatus={item.status}
                fileCount={item.files.length}
                paused={item.processingPaused}
              />
            </div>
          )}

          {showDetailColumns && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[0.8fr_2fr_1fr] overflow-hidden">
              <PortalDetailsColumn
                detailData={item.detailData}
                listData={item.listData}
                fieldComparisons={item.comparisonResult?.fieldComparisons ?? []}
                detailUrl={item.detailUrl}
              />
              <ComparisonColumn
                comparisonResult={item.comparisonResult}
                fwaAlerts={item.fwaAlerts}
                itemStatus={item.status}
              />
              <div className="md:col-span-2 lg:col-span-1">
                <DocumentViewerColumn
                  files={item.files}
                  portalId={portalId}
                  sessionId={sessionId}
                  itemId={item.id}
                />
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
