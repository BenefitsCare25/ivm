import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { PortalSessionCounts } from "@/lib/portal-session-summary";
import { summarizePortalSession } from "@/lib/portal-session-summary";

interface SessionProcessingSummaryProps {
  counts: PortalSessionCounts;
  configureAction?: ReactNode;
}

export function SessionProcessingSummary({
  counts,
  configureAction,
}: SessionProcessingSummaryProps) {
  const summary = summarizePortalSession(counts);
  const hasFailures = summary.failed > 0;
  const title = summary.isComplete
    ? hasFailures
      ? "Processing finished with issues"
      : "Processing complete"
    : (counts.PROCESSING ?? 0) > 0
      ? "Processing claims"
      : `${counts.DISCOVERED ?? 0} claim${counts.DISCOVERED === 1 ? "" : "s"} queued`;

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{title}</span>
          <span className="tabular-nums text-muted-foreground">
            {summary.finished} / {summary.total}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Claim processing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.percent}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              summary.isComplete
                ? hasFailures ? "bg-status-warning" : "bg-status-success"
                : "bg-status-info"
            }`}
            style={{ width: `${summary.percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{summary.percent}% complete</span>
          {summary.active > 0 && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {counts.DISCOVERED ?? 0} queued · {counts.PROCESSING ?? 0} running
            </span>
          )}
        </div>
      </div>

      {summary.isComplete && (
        <div
          className={`flex items-start gap-2 rounded-md px-3 py-2 ${
            hasFailures ? "bg-status-warning/10" : "bg-status-success/10"
          }`}
          role={hasFailures ? "alert" : "status"}
        >
          {hasFailures ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <p className={hasFailures ? "text-status-warning" : "text-status-success"}>
              <span className="font-medium">{title}. </span>
              {summary.reviewed} reviewed · {summary.needsDocuments} {summary.needsDocuments === 1 ? "needs" : "need"} documents
              {summary.failed > 0 && ` · ${summary.failed} failed`}
              {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
              {summary.filtered > 0 && ` · ${summary.filtered} filtered`}
            </p>
            {hasFailures && (
              <p className="text-muted-foreground">
                Failed claims could not be read and were not classified as missing documents. Check portal access, then retry them.
              </p>
            )}
            {summary.needsDocuments > 0 && (
              <p className="text-muted-foreground">
                “Need documents” means the claim page loaded successfully but no downloadable submission files were found.
              </p>
            )}
          </div>
          {configureAction}
        </div>
      )}
    </div>
  );
}
