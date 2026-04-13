"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AutoRefresh } from "./auto-refresh";
import { PortalAuthPanel } from "./portal-auth-panel";
import { PortalComparisonSetup } from "./portal-comparison-setup";
import { PortalSessionList } from "./portal-session-list";
import { ScrapeSessionModal } from "./scrape-session-modal";
import {
  ArrowLeft, Play, Loader2, Shield,
  Calendar, Settings, Trash2, AlertCircle, Hash,
  RefreshCw, FileText, HelpCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  groupingFields: string[];
  scrapeLimit: number | null;
  defaultDocumentTypeId: string | null;
  defaultDocumentTypeName: string | null;
  availableFields: string[];
  detectedClaimTypes: string[];
  sessions: SessionData[];
}

type AuthStatus = "ok" | "warn" | "expired" | "missing";

export function PortalDetailView({ portal }: { portal: PortalData }) {
  const router = useRouter();

  const [scraping, setScraping] = useState(false);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [limitInput, setLimitInput] = useState(portal.scrapeLimit?.toString() ?? "");
  const [savingLimit, setSavingLimit] = useState(false);
  const [showReAuth, setShowReAuth] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("ok");
  const [docTypes, setDocTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [docTypeId, setDocTypeId] = useState(portal.defaultDocumentTypeId ?? "");
  const [savingDocType, setSavingDocType] = useState(false);

  useEffect(() => {
    fetch("/api/intelligence/document-types")
      .then((r) => (r.ok ? r.json() : []))
      .then((types: Array<{ id: string; name: string; isActive?: boolean }>) =>
        setDocTypes(types.filter((t) => t.isActive !== false))
      )
      .catch(() => setDocTypes([]));
  }, []);

  // Computed client-side to avoid SSR hydration mismatch with date comparisons
  useEffect(() => {
    const now = new Date();
    const expiry = portal.cookieExpiresAt ? new Date(portal.cookieExpiresAt) : null;
    if (!portal.hasCredentials && !portal.hasCookies) {
      setAuthStatus("missing");
    } else if (portal.authMethod === "COOKIES" && expiry && expiry < now) {
      setAuthStatus("expired");
    } else if (
      portal.authMethod === "COOKIES" &&
      expiry &&
      expiry < new Date(now.getTime() + 24 * 60 * 60 * 1000)
    ) {
      setAuthStatus("warn");
    } else {
      setAuthStatus("ok");
    }
  }, [portal.hasCookies, portal.hasCredentials, portal.cookieExpiresAt, portal.authMethod]);

  async function saveDefaultDocType(newId: string) {
    setDocTypeId(newId);
    setSavingDocType(true);
    try {
      const res = await fetch(`/api/portals/${portal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultDocumentTypeId: newId || null }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setDocTypeId(portal.defaultDocumentTypeId ?? "");
      setError("Failed to update document type");
    } finally {
      setSavingDocType(false);
    }
  }

  async function saveScrapeLimit() {
    const value = limitInput.trim() === "" ? null : parseInt(limitInput, 10);
    if (value !== null && (isNaN(value) || value < 1)) return;
    setSavingLimit(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrapeLimit: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save limit");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scrape limit");
    } finally {
      setSavingLimit(false);
    }
  }

  async function triggerScrape(options?: {
    expectedDocumentTypeId?: string;
    expectedDocumentSetId?: string;
  }) {
    setScraping(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to trigger scrape");
      }
      setScrapeModalOpen(false);
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

  const hasActiveSessions = portal.sessions.some(
    (s) => s.status === "RUNNING" || s.status === "PENDING"
  );
  const hasProcessingItems = portal.sessions.some(
    (s) =>
      (s.itemStatusCounts["PROCESSING"] ?? 0) > 0 ||
      (s.itemStatusCounts["DISCOVERED"] ?? 0) > 0
  );
  const shouldRefresh = hasActiveSessions || hasProcessingItems;
  const authBad = authStatus === "expired" || authStatus === "missing";
  const authWarn = authStatus === "warn";

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
          <Button onClick={() => setScrapeModalOpen(true)} disabled={scraping}>
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

      {/* Auth expiry / missing warning banner */}
      {authBad && (
        <div className="flex items-start gap-3 rounded-lg border border-status-error/20 bg-status-error/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-error" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-status-error">
              {authStatus === "expired" ? "Authentication expired" : "Authentication not configured"}
            </p>
            <p className="text-xs text-status-error/80 mt-0.5">
              {authStatus === "expired"
                ? "Portal cookies have expired. Scraping will fail until you update authentication."
                : "No credentials saved. Configure authentication before scraping."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowReAuth(true)}
            className="h-7 shrink-0 text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Update auth
          </Button>
        </div>
      )}

      <FormError message={error} />

      {/* Status grid */}
      <TooltipProvider>
      <div className="grid gap-4 sm:grid-cols-5">
        <Card
          className={
            authBad ? "ring-1 ring-status-error/40" : authWarn ? "ring-1 ring-amber-400/40" : ""
          }
        >
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield
                className={`h-5 w-5 mt-0.5 shrink-0 ${
                  authBad ? "text-status-error" : authWarn ? "text-amber-500" : "text-muted-foreground"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <p className="text-sm font-medium text-foreground">Authentication</p>
                  <button
                    onClick={() => setShowReAuth(!showReAuth)}
                    className="text-[10px] leading-none text-muted-foreground hover:text-foreground"
                  >
                    {showReAuth ? "Cancel" : authBad ? "Set up ↓" : "Update ↓"}
                  </button>
                </div>
                <p
                  className={`text-xs ${
                    authBad ? "text-status-error" : authWarn ? "text-amber-500" : "text-muted-foreground"
                  }`}
                >
                  {portal.authMethod === "COOKIES" ? "Cookie-based" : "Credentials"}
                  {authStatus === "expired" && " · Expired"}
                  {authStatus === "missing" && " · Not configured"}
                  {authStatus === "warn" && " · Expiring soon"}
                  {authStatus === "ok" && portal.hasCookies && portal.cookieExpiresAt && (
                    <>
                      {" "}
                      &middot; Expires{" "}
                      <span suppressHydrationWarning>{formatDate(portal.cookieExpiresAt)}</span>
                    </>
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

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Hash className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground mb-1.5">Scrape Limit</p>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    placeholder="No limit"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveScrapeLimit()}
                    className="h-7 text-xs w-24"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveScrapeLimit}
                    disabled={savingLimit}
                    className="h-7 text-xs px-2"
                  >
                    {savingLimit ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-1.5">
                  <p className="text-sm font-medium text-foreground">Document Type</p>
                  <Tooltip
                    side="bottom"
                    content={
                      <div className="space-y-1.5">
                        <p className="font-medium text-popover-foreground">Default Document Type</p>
                        <p>Pre-selects a document type in the scrape session modal so you don&apos;t have to pick it every time.</p>
                        <p className="text-muted-foreground pt-1 border-t border-border">The system auto-classifies downloaded PDFs by reading them — this setting is just a convenience default.</p>
                      </div>
                    }
                  >
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                  </Tooltip>
                </div>
                {docTypes.length > 0 ? (
                  <select
                    value={docTypeId}
                    onChange={(e) => saveDefaultDocType(e.target.value)}
                    disabled={savingDocType}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                  >
                    <option value="">Not set</option>
                    {docTypes.map((dt) => (
                      <option key={dt.id} value={dt.id}>
                        {dt.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No document types configured.{" "}
                    <Link href="/intelligence/document-types" className="text-primary hover:underline">
                      Create one →
                    </Link>
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </TooltipProvider>

      {/* Inline re-auth panel */}
      {showReAuth && (
        <PortalAuthPanel
          portalId={portal.id}
          authMethod={portal.authMethod}
          baseUrl={portal.baseUrl}
          onClose={() => setShowReAuth(false)}
          onSaved={() => router.refresh()}
        />
      )}

      <PortalComparisonSetup
        portalId={portal.id}
        groupingFields={portal.groupingFields}
        availableFields={portal.availableFields}
        detectedClaimTypes={portal.detectedClaimTypes}
      />

      <PortalSessionList portalId={portal.id} sessions={portal.sessions} />

      <ScrapeSessionModal
        open={scrapeModalOpen}
        onOpenChange={setScrapeModalOpen}
        onStart={triggerScrape}
        loading={scraping}
        defaultDocumentTypeId={portal.defaultDocumentTypeId ?? undefined}
      />
    </div>
  );
}
