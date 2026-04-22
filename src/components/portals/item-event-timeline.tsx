"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Camera, AlertCircle, CheckCircle2, Info, Loader2, AlertTriangle } from "lucide-react";
import type { ItemEventSummary, ItemEventType, TrackedItemStatus } from "@/types/portal";
import { EVENT_TYPE_LABELS, EVENT_SEVERITY } from "@/types/portal";

interface ItemEventTimelineProps {
  portalId: string;
  sessionId: string;
  itemId: string;
  itemStatus: TrackedItemStatus;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function PayloadDetails({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([k]) => k !== "errorStack");
  if (entries.length === 0) return null;

  return (
    <div className="mt-1.5 rounded bg-muted px-2.5 py-1.5 text-xs text-muted-foreground space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 min-w-0">
          <span className="font-medium shrink-0">{k}:</span>
          <span className="truncate">
            {Array.isArray(v)
              ? (v as unknown[]).join(", ")
              : typeof v === "object"
              ? JSON.stringify(v)
              : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ItemEventTimeline({
  portalId,
  sessionId,
  itemId,
  itemStatus,
}: ItemEventTimelineProps) {
  const [events, setEvents] = useState<ItemEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        const res = await fetch(
          `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { events: ItemEventSummary[] };
        if (!cancelled) {
          const next = data.events ?? [];
          setEvents((prev) =>
            prev.length === next.length && prev[prev.length - 1]?.id === next[next.length - 1]?.id
              ? prev
              : next
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();

    // Auto-refresh while item is still being processed
    const isActive = itemStatus === "PROCESSING" || itemStatus === "DISCOVERED";
    const interval = isActive ? setInterval(fetchEvents, 3000) : undefined;

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [portalId, sessionId, itemId, itemStatus]);

  function toggleExpand(eventId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  function openScreenshot(screenshotPath: string) {
    const url = `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events/screenshot?path=${encodeURIComponent(screenshotPath)}`;
    setLightboxUrl(url);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading timeline…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground italic">No events recorded yet.</p>
    );
  }

  return (
    <>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Processing Timeline
      </p>

      <div className="relative pl-4">
          {/* Vertical connector line */}
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />

          {events.map((evt) => {
            const severity = EVENT_SEVERITY[evt.eventType as ItemEventType] ?? "info";
            const isError = severity === "error";
            const isSuccess = severity === "success";
            const isWarning = severity === "warning";
            const isExpanded = expanded.has(evt.id);
            const hasPayload = Object.keys(evt.payload).length > 0;

            const DotColor = isError
              ? "bg-red-500"
              : isWarning
              ? "bg-amber-500"
              : isSuccess
              ? "bg-emerald-500"
              : "bg-muted-foreground/40";

            const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : isSuccess ? CheckCircle2 : Info;
            const iconColor = isError
              ? "text-red-500"
              : isWarning
              ? "text-amber-500"
              : isSuccess
              ? "text-emerald-500"
              : "text-muted-foreground/60";

            return (
              <div key={evt.id} className="relative pb-2.5 last:pb-0">
                {/* Timeline dot */}
                <div
                  className={`absolute -left-[9.5px] top-[3px] h-2.5 w-2.5 rounded-full border-2 border-background ${DotColor}`}
                />

                <div
                  className={hasPayload ? "cursor-pointer" : undefined}
                  onClick={() => hasPayload && toggleExpand(evt.id)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />

                    <span
                      className={`text-xs font-medium truncate ${
                        isError ? "text-red-400" : "text-foreground"
                      }`}
                    >
                      {EVENT_TYPE_LABELS[evt.eventType as ItemEventType] ?? evt.eventType}
                    </span>

                    {evt.durationMs != null && (
                      <span className="text-[10px] text-muted-foreground/50 shrink-0">
                        {formatDuration(evt.durationMs)}
                      </span>
                    )}

                    {evt.screenshotPath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openScreenshot(evt.screenshotPath!);
                        }}
                        className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <Camera className="h-3 w-3" />
                        Screenshot
                      </button>
                    )}

                    <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">
                      {formatTime(evt.createdAt)}
                    </span>

                    {hasPayload && (
                      isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      )
                    )}
                  </div>

                  {isExpanded && <PayloadDetails payload={evt.payload} />}
                </div>
              </div>
            );
          })}
      </div>

      {/* Screenshot lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] overflow-auto rounded border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-2 right-2 z-10 rounded-full bg-background/80 px-2 py-0.5 text-sm text-foreground/80 hover:text-foreground"
            >
              ✕
            </button>
            <img src={lightboxUrl} alt="Failure screenshot" className="block max-w-full" />
          </div>
        </div>
      )}
    </>
  );
}
