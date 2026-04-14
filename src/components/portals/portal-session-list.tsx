import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeStatusBadge, ITEM_STATUS_COLORS } from "./portal-status-badge";
import { formatDate } from "@/lib/utils";
import type { ScrapeSessionStatus } from "@/types/portal";
import { TERMINAL_ITEM_STATUSES } from "@/types/portal";

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

const STATUS_ORDER = ["COMPARED", "FLAGGED", "SKIPPED", "ERROR", "PROCESSING", "DISCOVERED"];

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

              const total = s.itemsFound || 0;
              const processed = TERMINAL_ITEM_STATUSES.reduce(
                (sum, st) => sum + (s.itemStatusCounts[st] ?? 0),
                0
              );
              const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
              const isRunning = s.status === "RUNNING" || s.status === "PENDING";

              const statusEntries = STATUS_ORDER.filter(
                (st) => (s.itemStatusCounts[st] ?? 0) > 0
              ).map((st) => ({ status: st, count: s.itemStatusCounts[st] }));

              return (
                <div key={s.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ScrapeStatusBadge status={s.status} />
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
                          Processing {processed} of {total} items
                        </span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  ) : isRunning ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Scraping list page…
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
                          {count} {status.toLowerCase()}
                        </span>
                      ))}
                      {total > 0 && (
                        <span className="text-xs text-muted-foreground self-center">
                          ({processed}/{total} processed)
                        </span>
                      )}
                    </div>
                  ) : total > 0 ? (
                    <p className="text-xs text-muted-foreground">{total} items found</p>
                  ) : null}

                  {s.errorMessage && (
                    <div className="flex items-start gap-2 rounded-md bg-status-error/10 px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-error mt-0.5" />
                      <p className="text-xs text-status-error">{s.errorMessage}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
