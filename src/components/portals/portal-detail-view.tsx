"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Play, Loader2, Globe, Clock, Shield,
  Calendar, Settings, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import { ScrapeStatusBadge } from "./portal-status-badge";
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

export function PortalDetailView({ portal }: { portal: PortalData }) {
  const router = useRouter();
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Trigger</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Items</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Started</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Duration</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {portal.sessions.map((s) => {
                    const duration =
                      s.startedAt && s.completedAt
                        ? Math.round(
                            (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
                          )
                        : null;
                    return (
                      <tr key={s.id} className="border-t border-border">
                        <td className="px-4 py-2.5">
                          <ScrapeStatusBadge status={s.status} />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.triggeredBy}</td>
                        <td className="px-4 py-2.5">
                          {s.itemsProcessed}/{s.itemsFound}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {s.startedAt ? formatDate(s.startedAt) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {duration !== null ? `${duration}s` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/portals/${portal.id}/sessions/${s.id}`}>
                              View Items
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
