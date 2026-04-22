"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, XCircle, Loader2, Clock, AlertTriangle, Info } from "lucide-react";
import { PortalDetailsColumn } from "./portal-details-column";
import { ComparisonColumn } from "./comparison-column";
import { DocumentViewerColumn } from "./document-viewer-column";
import type { TrackedItemStatus, ItemFile, ComparisonSummary, ValidationAlert, ItemEventSummary, ItemEventType } from "@/types/portal";
import { EVENT_TYPE_LABELS, EVENT_SEVERITY } from "@/types/portal";

interface ExpandedPanelItem {
  id: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  errorMessage: string | null;
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
}: {
  portalId: string;
  sessionId: string;
  itemId: string;
  itemStatus: TrackedItemStatus;
}) {
  const [events, setEvents] = useState<ItemEventSummary[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchEvents() {
      try {
        const res = await fetch(
          `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events`
        );
        if (!res.ok || !mountedRef.current) return;
        const data = (await res.json()) as { events: ItemEventSummary[] };
        if (mountedRef.current) setEvents(data.events ?? []);
      } catch {
        // non-fatal
      }
    }

    fetchEvents();
    const isActive = itemStatus === "PROCESSING" || itemStatus === "DISCOVERED";
    const interval = isActive ? setInterval(fetchEvents, 3000) : undefined;

    return () => {
      mountedRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [portalId, sessionId, itemId, itemStatus]);

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Waiting for activity…</p>
    );
  }

  // Show last 8 events, latest first
  const recent = [...events].reverse().slice(0, 8);
  const hasWarning = events.some(
    (e) => EVENT_SEVERITY[e.eventType as ItemEventType] === "warning"
  );
  const hasError = events.some(
    (e) => EVENT_SEVERITY[e.eventType as ItemEventType] === "error"
  );
  const extractDone = events.filter((e) => e.eventType === "AI_EXTRACT_DONE").length;
  const extractStart = events.filter((e) => e.eventType === "AI_EXTRACT_START").length;
  const truncated = events.filter((e) => e.eventType === "AI_EXTRACT_TRUNCATED").length;
  const extractFail = events.filter((e) => e.eventType === "AI_EXTRACT_FAIL").length;

  return (
    <div className="space-y-2">
      {/* Progress summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {extractStart > 0 && (
          <span className="text-muted-foreground">
            Files:{" "}
            <span className="font-medium text-foreground">
              {extractDone}/{extractStart}
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
        {!hasWarning && !hasError && extractDone > 0 && (
          <span className="text-emerald-500 font-medium">All clean so far</span>
        )}
      </div>

      {/* Recent events list */}
      <div className="space-y-0.5">
        {recent.map((evt) => {
          const severity = EVENT_SEVERITY[evt.eventType as ItemEventType] ?? "info";
          const label = EVENT_TYPE_LABELS[evt.eventType as ItemEventType] ?? evt.eventType;
          const fileName = evt.payload.fileName as string | undefined;

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
  SKIPPED:   { icon: Clock,        label: "Skipped",      cls: "text-muted-foreground" },
};

export function ExpandedPanel({ item, portalId, sessionId, columnCount }: ExpandedPanelProps) {
  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.DISCOVERED;
  const StatusIcon = cfg.icon;

  return (
    <tr>
      <td colSpan={columnCount} className="p-0">
        <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-4">

          <div className="flex items-start gap-2">
            <StatusIcon
              className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cfg.cls} ${
                item.status === "PROCESSING" ? "animate-spin" : ""
              }`}
            />
            <span className={`text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
            {item.status === "ERROR" && item.errorMessage && (
              <span className="text-xs text-status-error/80 ml-2">
                &mdash; {item.errorMessage}
              </span>
            )}
          </div>

          {(item.status === "PROCESSING" || item.status === "DISCOVERED") ? (
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Live Activity
              </p>
              <ProcessingFeed
                portalId={portalId}
                sessionId={sessionId}
                itemId={item.id}
                itemStatus={item.status}
              />
            </div>
          ) : (
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
