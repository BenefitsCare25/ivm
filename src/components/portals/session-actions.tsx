"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw, Play, CheckCircle2, Square, Trash2, Loader2, SkipForward, FileSliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComparisonTemplateModal } from "./comparison-template-modal";

interface SessionActionsProps {
  portalId: string;
  sessionId: string;
  counts: {
    COMPARED: number;
    FLAGGED: number;
    ERROR: number;
    PROCESSING: number;
    DISCOVERED: number;
    SKIPPED?: number;
  };
  sessionStatus: string;
}

export function SessionActions({
  portalId,
  sessionId,
  counts,
  sessionStatus,
}: SessionActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"failed" | "unprocessed" | "skip" | "stop" | "delete" | null>(null);
  const autoRetriedRef = useRef(false);
  const [unconfiguredTypes, setUnconfiguredTypes] = useState<Array<{
    groupingKey: Record<string, string>;
    itemId: string;
    fieldOptions: Array<{ name: string; pageValue?: string; pdfValue?: string }>;
  }>>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [currentTypeIndex, setCurrentTypeIndex] = useState(0);
  const checkedUnconfiguredRef = useRef(false);
  const [recompareError, setRecompareError] = useState<string | null>(null);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0) + (counts.ERROR ?? 0) + (counts.SKIPPED ?? 0);
  const inFlight = (counts.PROCESSING ?? 0) + (counts.DISCOVERED ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = total > 0 && inFlight === 0;

  // Auto-retry failed items once when nothing else is running.
  // Uses sessionStorage to prevent re-triggering across re-renders and page refreshes.
  useEffect(() => {
    const errorCount = counts.ERROR ?? 0;
    if (errorCount === 0 || inFlight > 0 || autoRetriedRef.current) return;

    const storageKey = `auto_retried_${sessionId}`;
    if (sessionStorage.getItem(storageKey)) return;

    autoRetriedRef.current = true;
    sessionStorage.setItem(storageKey, "1");
    reprocess("failed");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.ERROR, inFlight, sessionId]);

  function fetchUnconfiguredTypes() {
    fetch(`/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.unconfiguredTypes) && data.unconfiguredTypes.length > 0) {
          setUnconfiguredTypes(data.unconfiguredTypes);
          setCurrentTypeIndex(0);
          setShowTemplateModal(true);
        }
      })
      .catch(() => {});
  }

  // Check for unconfigured claim types once processing is complete
  useEffect(() => {
    const compared = (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0);
    if (!isComplete || compared === 0 || checkedUnconfiguredRef.current) return;

    const storageKey = `unconfigured_checked_${sessionId}`;
    if (sessionStorage.getItem(storageKey)) return;

    checkedUnconfiguredRef.current = true;
    sessionStorage.setItem(storageKey, "1");
    fetchUnconfiguredTypes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, counts.COMPARED, counts.FLAGGED]);

  async function skipFailed() {
    setLoading("skip");
    try {
      const res = await fetch(
        `/api/portals/${portalId}/scrape/${sessionId}/reprocess`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "skip" }) }
      );
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function reprocess(type: "failed" | "unprocessed") {
    setLoading(type);
    try {
      const res = await fetch(
        `/api/portals/${portalId}/scrape/${sessionId}/reprocess`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) }
      );
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function stopSession() {
    setLoading("stop");
    try {
      const res = await fetch(`/api/portals/${portalId}/scrape/${sessionId}`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function deleteSession() {
    if (!confirm("Delete this session and all its items? This cannot be undone.")) return;
    setLoading("delete");
    try {
      const res = await fetch(`/api/portals/${portalId}/scrape/${sessionId}`, { method: "DELETE" });
      if (res.ok) router.push(`/portals/${portalId}`);
    } finally {
      setLoading(null);
    }
  }

  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            {isComplete ? "All items processed" : `Processing items…`}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {done} / {total}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              isComplete ? "bg-status-success" : "bg-blue-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{pct}% complete</span>
          {inFlight > 0 && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {counts.DISCOVERED ?? 0} queued · {counts.PROCESSING ?? 0} running
            </span>
          )}
        </div>
      </div>

      {/* Completion banner */}
      {isComplete && (
        <div className="flex items-center gap-2 rounded-md bg-status-success/10 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-status-success shrink-0" />
          <div className="flex-1 text-xs text-status-success">
            <span className="font-medium">Done. </span>
            {counts.COMPARED ?? 0} matched · {counts.FLAGGED ?? 0} flagged
            {(counts.SKIPPED ?? 0) > 0 && ` · ${counts.SKIPPED} skipped`}
            {(counts.ERROR ?? 0) > 0 && ` · ${counts.ERROR} failed`}
          </div>
          {isComplete && (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0) > 0 && unconfiguredTypes.length === 0 && !showTemplateModal && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-status-success hover:text-status-success hover:bg-status-success/10"
              onClick={() => {
                const storageKey = `unconfigured_checked_${sessionId}`;
                sessionStorage.removeItem(storageKey);
                checkedUnconfiguredRef.current = false;
                fetchUnconfiguredTypes();
              }}
            >
              <FileSliders className="mr-1 h-3 w-3" />
              Configure Templates
            </Button>
          )}
        </div>
      )}

      {/* Recompare error banner */}
      {recompareError && (
        <div className="flex items-center gap-2 rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <span className="flex-1">{recompareError}</span>
          <button onClick={() => setRecompareError(null)} className="text-status-warning hover:opacity-70">✕</button>
        </div>
      )}

      {/* Unconfigured claim types banner */}
      {unconfiguredTypes.length > 0 && !showTemplateModal && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
          <FileSliders className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-sm text-muted-foreground">
            {unconfiguredTypes.length} claim type{unconfiguredTypes.length > 1 ? "s" : ""} used
            full comparison. Configure templates for focused field matching.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCurrentTypeIndex(0);
              setShowTemplateModal(true);
            }}
          >
            Configure
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Retry / Skip failed items */}
        {(counts.ERROR ?? 0) > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reprocess("failed")}
              disabled={loading !== null}
            >
              {loading === "failed" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Retry {counts.ERROR} failed
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={skipFailed}
              disabled={loading !== null}
              className="text-muted-foreground"
            >
              {loading === "skip" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              )}
              Skip {counts.ERROR} failed
            </Button>
          </>
        )}

        {/* Continue unprocessed — show when DISCOVERED > 0 and session isn't actively running */}
        {(counts.DISCOVERED ?? 0) > 0 && sessionStatus !== "RUNNING" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocess("unprocessed")}
            disabled={loading !== null}
          >
            {loading === "unprocessed" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Continue {counts.DISCOVERED} unprocessed
          </Button>
        )}

        {/* Stop — only when actively running (RUNNING session or items currently being processed) */}
        {(sessionStatus === "RUNNING" || (counts.PROCESSING ?? 0) > 0) && (
          <Button
            variant="outline"
            size="sm"
            onClick={stopSession}
            disabled={loading !== null}
            className="text-status-warning border-status-warning/40 hover:bg-status-warning/10"
          >
            {loading === "stop" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="mr-1.5 h-3.5 w-3.5" />
            )}
            Stop
          </Button>
        )}

        {/* Refresh + Delete */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.refresh()}
            className="text-muted-foreground"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={deleteSession}
            disabled={loading !== null}
            className="text-status-error hover:text-status-error hover:bg-status-error/10"
          >
            {loading === "delete" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {/* Inline template configuration modal */}
      {showTemplateModal && unconfiguredTypes[currentTypeIndex] && (
        <ComparisonTemplateModal
          portalId={portalId}
          groupingKey={unconfiguredTypes[currentTypeIndex].groupingKey}
          suggestedName={Object.values(unconfiguredTypes[currentTypeIndex].groupingKey).join(" / ")}
          availableFields={unconfiguredTypes[currentTypeIndex].fieldOptions}
          onSaved={async (templateId) => {
            setShowTemplateModal(false);
            setRecompareError(null);
            try {
              const res = await fetch(`/api/portals/${portalId}/scrape/${sessionId}/recompare`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ templateId }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setRecompareError(body.message ?? "Recompare failed — items may need manual refresh");
              }
            } catch {
              setRecompareError("Recompare failed — check your API key and try again");
            }
            const nextIndex = currentTypeIndex + 1;
            if (nextIndex < unconfiguredTypes.length) {
              setCurrentTypeIndex(nextIndex);
              setShowTemplateModal(true);
            } else {
              setUnconfiguredTypes([]);
              router.refresh();
            }
          }}
          onSkip={() => {
            setShowTemplateModal(false);
            const nextIndex = currentTypeIndex + 1;
            if (nextIndex < unconfiguredTypes.length) {
              setCurrentTypeIndex(nextIndex);
              setShowTemplateModal(true);
            } else {
              setUnconfiguredTypes([]);
            }
          }}
        />
      )}
    </div>
  );
}
