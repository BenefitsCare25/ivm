"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw, RotateCcw, Play, Square, Trash2, Loader2, SkipForward, FileSliders, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ComparisonTemplateModal } from "./comparison-template-modal";
import { SessionProcessingSummary } from "./session-processing-summary";
import { summarizePortalSession } from "@/lib/portal-session-summary";
import type { PortalSessionCounts } from "@/lib/portal-session-summary";
import type { ProviderGroupSummary, AuthStatus, ScrapeSessionStatus } from "@/types/portal";

interface SessionActionsProps {
  portalId: string;
  sessionId: string;
  counts: PortalSessionCounts;
  sessionStatus: ScrapeSessionStatus;
  authStatus?: AuthStatus;
}

export function SessionActions({
  portalId,
  sessionId,
  counts,
  sessionStatus,
  authStatus = "ok",
}: SessionActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"failed" | "unprocessed" | "documents" | "skip" | "stop" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unconfiguredTypes, setUnconfiguredTypes] = useState<Array<{
    groupingKey: Record<string, string>;
    itemId: string;
    fieldOptions: Array<{ name: string; pageValue?: string; pdfValue?: string }>;
  }>>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [currentTypeIndex, setCurrentTypeIndex] = useState(0);
  const checkedUnconfiguredRef = useRef(false);
  const [recompareError, setRecompareError] = useState<string | null>(null);
  const [unconfiguredConfigId, setUnconfiguredConfigId] = useState<string | null>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderGroupSummary[]>([]);

  const authBad = authStatus === "expired" || authStatus === "session_expired" || authStatus === "missing";
  // The credential itself is unusable (cookies expired with no fallback, or nothing
  // configured) — resuming would fail immediately, so gate the resume actions on this
  // and NOT on `authBad`. `session_expired` means the credential is valid again
  // (cookies re-captured) but the session carries a stale mid-run auth flag; resuming
  // there is exactly the "re-capture then Continue" path and it clears the flag —
  // gating it on `authBad` deadlocks the session (the only clearer is unreachable).
  const credentialBad = authStatus === "expired" || authStatus === "missing";

  const summary = summarizePortalSession(counts);
  const isComplete = summary.isComplete;

  async function fetchUnconfiguredTypes() {
    try {
      const [configResponse, groupsResponse] = await Promise.all([
        fetch(`/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types`),
        fetch(`/api/portals/${portalId}/provider-groups`),
      ]);
      if (!configResponse.ok) throw new Error("Template configuration request failed");

      const data = await configResponse.json();
      const groups = groupsResponse.ok ? await groupsResponse.json() : [];
      if (Array.isArray(groups)) setProviderGroups(groups);
      if (Array.isArray(data.unconfiguredTypes) && data.unconfiguredTypes.length > 0) {
        setUnconfiguredTypes(data.unconfiguredTypes);
        setUnconfiguredConfigId(data.configId ?? null);
        setCurrentTypeIndex(0);
        setShowTemplateModal(true);
      }
    } catch {
      setActionError("Could not check comparison templates. Refresh the session to try again.");
    }
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
    setActionError(null);
    try {
      const res = await fetch(
        `/api/portals/${portalId}/scrape/${sessionId}/reprocess`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "skip" }) }
      );
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? body.message ?? "Failed to skip items — please try again");
      }
    } catch {
      setActionError("Network error — please check your connection");
    } finally {
      setLoading(null);
    }
  }

  async function reprocess(type: "failed" | "unprocessed" | "documents") {
    setLoading(type);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/portals/${portalId}/scrape/${sessionId}/reprocess`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) }
      );
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? body.message ?? "Failed to queue items — please try again");
      }
    } catch {
      setActionError("Network error — please check your connection");
    } finally {
      setLoading(null);
    }
  }

  async function stopSession() {
    setLoading("stop");
    setActionError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/scrape/${sessionId}`, { method: "POST" });
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? body.message ?? "Failed to stop the session — please try again");
      }
    } catch {
      setActionError("Network error — please check your connection");
    } finally {
      setLoading(null);
    }
  }

  async function deleteSession() {
    if (!confirm("Delete this session and all its items? This cannot be undone.")) return;
    setLoading("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/scrape/${sessionId}`, { method: "DELETE" });
      if (res.ok) router.push(`/portals/${portalId}`);
      else {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? body.message ?? "Failed to delete the session — please try again");
      }
    } catch {
      setActionError("Network error — please check your connection");
    } finally {
      setLoading(null);
    }
  }

  if (summary.total === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <SessionProcessingSummary
        counts={counts}
        configureAction={
          isComplete &&
          (counts.COMPARED ?? 0) + (counts.FLAGGED ?? 0) > 0 &&
          unconfiguredTypes.length === 0 &&
          !showTemplateModal ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs"
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
          ) : undefined
        }
      />

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-md bg-status-error/10 px-3 py-2 text-xs text-status-error">
          <span className="flex-1">{actionError}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)} className="text-status-error hover:opacity-70">✕</button>
        </div>
      )}

      {/* Recompare error banner */}
      {recompareError && (
        <div className="flex items-center gap-2 rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <span className="flex-1">{recompareError}</span>
          <button type="button" aria-label="Dismiss warning" onClick={() => setRecompareError(null)} className="text-status-warning hover:opacity-70">✕</button>
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

      {/* Auth warning — shown when portal auth is expired or missing */}
      {authBad && ((counts.ERROR ?? 0) > 0 || (counts.DISCOVERED ?? 0) > 0) && (
        <div className="flex items-center gap-2 rounded-md bg-status-error/10 px-3 py-2 text-xs text-status-error">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {authStatus === "session_expired"
              ? "Portal session expired mid-scrape. Re-capture cookies on the portal page (if you haven't), then click Continue/Retry below to resume the remaining items."
              : authStatus === "expired"
              ? "Portal cookies have expired. Update authentication on the portal page, then Continue/Retry to resume."
              : "Authentication not configured. Set up cookies or credentials before retrying."}
          </span>
          <Link
            href={`/portals/${portalId}`}
            className="shrink-0 text-xs font-medium underline underline-offset-2 hover:opacity-80"
          >
            Portal settings
          </Link>
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
              disabled={loading !== null || credentialBad}
              title={credentialBad ? "Update portal authentication before retrying" : undefined}
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

        {(counts.REQUIRE_DOC ?? 0) > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocess("documents")}
            disabled={loading !== null || credentialBad}
            title={credentialBad ? "Update portal authentication before rechecking documents" : undefined}
          >
            {loading === "documents" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Recheck {counts.REQUIRE_DOC} {counts.REQUIRE_DOC === 1 ? "claim" : "claims"} needing documents
          </Button>
        )}

        {/* Continue unprocessed — show when DISCOVERED > 0 and session isn't actively running */}
        {(counts.DISCOVERED ?? 0) > 0 && sessionStatus !== "RUNNING" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocess("unprocessed")}
            disabled={loading !== null || credentialBad}
            title={credentialBad ? "Update portal authentication before continuing" : undefined}
          >
            {loading === "unprocessed" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Continue {counts.DISCOVERED} unprocessed
          </Button>
        )}

        {/* Stop — available while this non-cancelled session still has active work. */}
        {summary.active > 0 && sessionStatus !== "CANCELLED" && sessionStatus !== "FAILED" && (
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

      {showTemplateModal && unconfiguredTypes[currentTypeIndex] && (
        <ComparisonTemplateModal
          portalId={portalId}
          configId={unconfiguredConfigId ?? undefined}
          groupingKey={unconfiguredTypes[currentTypeIndex].groupingKey}
          suggestedName={Object.values(unconfiguredTypes[currentTypeIndex].groupingKey).join(" / ")}
          availableFields={unconfiguredTypes[currentTypeIndex].fieldOptions}
          providerGroups={providerGroups.length > 0 ? providerGroups : undefined}
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
    </Card>
  );
}
