import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeStatusBadge, ITEM_STATUS_COLORS } from "./portal-status-badge";
import { formatDate } from "@/lib/utils";
import { summarizePortalSession } from "@/lib/portal-session-summary";
import {
  TRACKED_ITEM_STATUS_LABELS,
  type ScrapeSessionStatus,
  type TrackedItemStatus,
} from "@/types/portal";

interface SessionData {
  id: string;
  status: ScrapeSessionStatus;
  triggeredBy: string;
  itemsFound: number;
  itemsProcessed: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  itemStatusCounts: Record<string, number>;
}

interface PortalSessionListProps {
  portalId: string;
  sessions: SessionData[];
}

const STATUS_ORDER: TrackedItemStatus[] = [
  "COMPARED",
  "VERIFIED",
  "FLAGGED",
  "REQUIRE_DOC",
  "SKIPPED",
  "FILTERED",
  "ERROR",
  "PROCESSING",
  "DISCOVERED",
];

export function PortalSessionList({ portalId, sessions }: PortalSessionListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scrape Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No scrape sessions yet. Click &quot;Scrape Now&quot; to start.
          </p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const duration =
                s.startedAt && s.completedAt
                  ? Math.round(
                      (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
                    )
                  : null;

              const summary = summarizePortalSession(s.itemStatusCounts);
              const total = summary.total || s.itemsFound || 0;
              const processed = summary.finished;
              const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
              let displayStatus = s.status;
              if (summary.total > 0 && s.status !== "CANCELLED") {
                if ((s.itemStatusCounts.PROCESSING ?? 0) > 0) displayStatus = "RUNNING";
                else if ((s.itemStatusCounts.DISCOVERED ?? 0) > 0) displayStatus = "PENDING";
                else if (summary.failed > 0) displayStatus = "FAILED";
                else displayStatus = "COMPLETED";
              }
              const isRunning = displayStatus === "RUNNING" || displayStatus === "PENDING";

              const statusEntries = STATUS_ORDER.filter(
                (st) => (s.itemStatusCounts[st] ?? 0) > 0
              ).map((st) => ({ status: st, count: s.itemStatusCounts[st] }));

              return (
                <Card key={s.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ScrapeStatusBadge status={displayStatus} />
                      <span className="text-xs text-muted-foreground">{s.triggeredBy}</span>
                      {s.startedAt && (
                        <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                          {formatDate(s.startedAt)}
                        </span>
                      )}
                      {duration !== null && (
                        <span className="text-xs text-muted-foreground">{duration}s</span>
                      )}
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0">
                      <Link href={`/portals/${portalId}/sessions/${s.id}`}>View Items</Link>
                    </Button>
                  </div>

                  {isRunning && total > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          Processing {processed} of {total} claims
                        </span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-status-info transition-[width] duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  ) : isRunning ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Scraping claim list…
                    </p>
                  ) : statusEntries.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {statusEntries.map(({ status, count }) => (
                        <span
                          key={status}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            ITEM_STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {count} {TRACKED_ITEM_STATUS_LABELS[status].toLowerCase()}
                        </span>
                      ))}
                      {total > 0 && (
                        <span className="text-xs text-muted-foreground self-center">
                          ({processed}/{total} finished)
                        </span>
                      )}
                    </div>
                  ) : total > 0 ? (
                    <p className="text-xs text-muted-foreground">{total} claims found</p>
                  ) : null}

                  {s.errorMessage && (
                    <div className="flex items-start gap-2 rounded-md bg-status-error/10 px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-error mt-0.5" />
                      <p className="text-xs text-status-error">{s.errorMessage}</p>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
