"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AutoRefresh } from "./auto-refresh";
import {
  ArrowLeft, Play, Loader2, Shield,
  Calendar, Settings, Trash2, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeStatusBadge, ITEM_STATUS_COLORS } from "./portal-status-badge";
import { FormError } from "@/components/ui/form-error";
import { formatDate } from "@/lib/utils";
import type { ScrapeSessionStatus } from "@/types/portal";


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

interface PortalData {
  id: string;
  name: string;
  baseUrl: string;
  listPageUrl: string | null;
  authMethod: string;
  listSelectors: Record<string, unknown>;
  detailSelectors: Record<string, unknown>;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  hasCredentials: boolean;
  hasCookies: boolean;
  cookieExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessions: SessionData[];
}

const STATUS_ORDER = ["COMPARED", "FLAGGED", "SKIPPED", "ERROR", "PROCESSING", "DISCOVERED"];

export function PortalDetailView({ portal }: { portal: PortalData }) {
  const router = useRouter();
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Auto-refresh when any session is active
  const hasActiveSessions = portal.sessions.some(
    (s) => s.status === "RUNNING" || s.status === "PENDING"
  );
  const hasProcessingItems = portal.sessions.some(
    (s) => (s.itemStatusCounts["PROCESSING"] ?? 0) > 0 || (s.itemStatusCounts["DISCOVERED"] ?? 0) > 0
  );
  const shouldRefresh = hasActiveSessions || hasProcessingItems;

  async function triggerScrape() {
    setScraping(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}/scrape`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to trigger scrape");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger scrape");
    } finally {
      setScraping(false);
    }
  }

  async function deletePortal() {
    if (!confirm("Delete this portal and all its data?")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
      router.push("/portals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete portal");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/portals">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{portal.name}</h1>
            <p className="text-sm text-muted-foreground">{portal.baseUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {shouldRefresh && <AutoRefresh />}
          <Button onClick={triggerScrape} disabled={scraping}>
            {scraping ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Scrape Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={deletePortal}
            disabled={deleting}
            className="text-status-error hover:text-status-error"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FormError message={error} />

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Authentication</p>
                <p className="text-xs text-muted-foreground">
                  {portal.authMethod === "COOKIES" ? "Cookie-based" : "Credentials"}
                  {portal.hasCookies && portal.cookieExpiresAt && (
                    <> &middot; Expires {formatDate(portal.cookieExpiresAt)}</>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Schedule</p>
                <p className="text-xs text-muted-foreground">
                  {portal.scheduleEnabled ? portal.scheduleCron : "Manual only"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Selectors</p>
                <p className="text-xs text-muted-foreground">
                  {Object.keys(portal.listSelectors).length > 0 ? "Configured" : "Not configured"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Session history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scrape Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {portal.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No scrape sessions yet. Click &quot;Scrape Now&quot; to start.
            </p>
          ) : (
            <div className="space-y-3">
              {portal.sessions.map((s) => {
                const duration =
                  s.startedAt && s.completedAt
                    ? Math.round(
                        (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
                      )
                    : null;

                const total = s.itemsFound || 0;
                // Compute from actual status counts — itemsProcessed double-counts retries
                const TERMINAL_STATUSES = ["COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED"] as const;
                const processed = TERMINAL_STATUSES.reduce((sum, st) => sum + (s.itemStatusCounts[st] ?? 0), 0);
                const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
                const isRunning = s.status === "RUNNING" || s.status === "PENDING";

                const statusEntries = STATUS_ORDER
                  .filter((st) => (s.itemStatusCounts[st] ?? 0) > 0)
                  .map((st) => ({ status: st, count: s.itemStatusCounts[st] }));

                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-border p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScrapeStatusBadge status={s.status} />
                        <span className="text-xs text-muted-foreground">{s.triggeredBy}</span>
                        {s.startedAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(s.startedAt)}
                          </span>
                        )}
                        {duration !== null && (
                          <span className="text-xs text-muted-foreground">{duration}s</span>
                        )}
                      </div>
                      <Button variant="outline" size="sm" asChild className="shrink-0">
                        <Link href={`/portals/${portal.id}/sessions/${s.id}`}>
                          View Items
                        </Link>
                      </Button>
                    </div>

                    {isRunning && total > 0 ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Processing {processed} of {total} items</span>
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
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ITEM_STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}
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
    </div>
  );
}
