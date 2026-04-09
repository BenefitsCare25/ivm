"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AutoRefresh } from "./auto-refresh";
import { GroupingFieldConfig } from "./grouping-field-config";
import { TemplateList } from "./template-list";
import {
  ArrowLeft, Play, Loader2, Shield,
  Calendar, Settings, Trash2, AlertCircle, Hash,
  RefreshCw, Copy, Check, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrapeStatusBadge, ITEM_STATUS_COLORS } from "./portal-status-badge";
import { FormError } from "@/components/ui/form-error";
import { formatDate } from "@/lib/utils";
import { detectExtension, captureCookiesFromExtension, syncExtensionConfig, type ExtensionCookie } from "@/lib/extension";
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
  availableFields: string[];
  detectedClaimTypes: string[];
  sessions: SessionData[];
}

const STATUS_ORDER = ["COMPARED", "FLAGGED", "SKIPPED", "ERROR", "PROCESSING", "DISCOVERED"];

type AuthStatus = "ok" | "warn" | "expired" | "missing";

export function PortalDetailView({ portal }: { portal: PortalData }) {
  const router = useRouter();

  // Existing state
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [limitInput, setLimitInput] = useState(portal.scrapeLimit?.toString() ?? "");
  const [savingLimit, setSavingLimit] = useState(false);

  // Auth re-auth state
  const [showReAuth, setShowReAuth] = useState(false);
  const [cookieJson, setCookieJson] = useState("");
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  // Chrome extension capture state (for COOKIES auth)
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [capturingCookies, setCapturingCookies] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [showManualPaste, setShowManualPaste] = useState(false);

  // Auth status — computed client-side to avoid SSR hydration mismatch with dates
  const [authStatus, setAuthStatus] = useState<AuthStatus>("ok");

  // Import comparison setup state
  const [showImport, setShowImport] = useState(false);
  const [importPortals, setImportPortals] = useState<Array<{ id: string; name: string }>>([]);
  const [importSourceId, setImportSourceId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoadingPortals, setImportLoadingPortals] = useState(false);
  const [importDone, setImportDone] = useState(false);

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

  // Detect Chrome Extension when re-auth panel opens for COOKIES portals
  useEffect(() => {
    if (!showReAuth || portal.authMethod !== "COOKIES") return;
    detectExtension().then((detected) => {
      setExtensionDetected(detected);
      if (detected) {
        // Reset manual paste when extension is available
        setShowManualPaste(false);
        setCapturedCount(0);
      }
    });
  }, [showReAuth, portal.authMethod]);

  function mapSameSite(val?: string): "None" | "Lax" | "Strict" | undefined {
    if (!val) return undefined;
    const v = val.toLowerCase();
    if (v === "none") return "None";
    if (v === "strict") return "Strict";
    return "Lax";
  }

  function mapChromeCookies(cookies: ExtensionCookie[]) {
    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      expires: c.expires ?? c.expirationDate,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: mapSameSite(c.sameSite),
    }));
  }

  async function handleCaptureCookies() {
    setCapturingCookies(true);
    setCookieError(null);
    try {
      const userId = (document.cookie.match(/next-auth\.session-token/) ? "" : "");
      void syncExtensionConfig(userId);
      const cookies = await captureCookiesFromExtension(portal.baseUrl);
      const mapped = mapChromeCookies(cookies);
      setCookieJson(JSON.stringify(mapped, null, 2));
      setCapturedCount(mapped.length);
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : "Failed to capture cookies");
    } finally {
      setCapturingCookies(false);
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

  async function saveCookies() {
    setCookieSaving(true);
    setCookieError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cookieJson);
      } catch {
        throw new Error("Invalid JSON — paste a valid JSON array of cookie objects");
      }
      if (!Array.isArray(parsed)) throw new Error("Must be a JSON array of cookie objects");
      const res = await fetch(`/api/portals/${portal.id}/cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: parsed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save cookies");
      }
      setShowReAuth(false);
      setCookieJson("");
      router.refresh();
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : "Failed to save cookies");
    } finally {
      setCookieSaving(false);
    }
  }

  async function saveCredentials() {
    if (!credUsername.trim() || !credPassword.trim()) {
      setCredError("Both username and password are required");
      return;
    }
    setCredSaving(true);
    setCredError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: credUsername, password: credPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save credentials");
      }
      setShowReAuth(false);
      setCredUsername("");
      setCredPassword("");
      router.refresh();
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setCredSaving(false);
    }
  }

  async function openImport() {
    setShowImport(true);
    setImportError(null);
    setImportSourceId("");
    setImportDone(false);
    setImportLoadingPortals(true);
    try {
      const res = await fetch("/api/portals");
      const data = await res.json();
      setImportPortals(
        Array.isArray(data) ? data.filter((p: { id: string }) => p.id !== portal.id) : []
      );
    } catch {
      setImportError("Failed to load portals");
    } finally {
      setImportLoadingPortals(false);
    }
  }

  async function executeImport() {
    if (!importSourceId) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/portals/${portal.id}/comparison-setup/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePortalId: importSourceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to import");
      }
      setImportDone(true);
      setTimeout(() => {
        setShowImport(false);
        setImportDone(false);
        router.refresh();
      }, 1200);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import comparison setup");
    } finally {
      setImporting(false);
    }
  }

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

      {/* 4-card status grid */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card
          className={
            authBad
              ? "ring-1 ring-status-error/40"
              : authWarn
              ? "ring-1 ring-amber-400/40"
              : ""
          }
        >
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield
                className={`h-5 w-5 mt-0.5 shrink-0 ${
                  authBad
                    ? "text-status-error"
                    : authWarn
                    ? "text-amber-500"
                    : "text-muted-foreground"
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
                    authBad
                      ? "text-status-error"
                      : authWarn
                      ? "text-amber-500"
                      : "text-muted-foreground"
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
                      <span suppressHydrationWarning>
                        {formatDate(portal.cookieExpiresAt)}
                      </span>
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
      </div>

      {/* Inline re-auth panel — shown below the grid when user clicks "Update ↓" or "Set up ↓" */}
      {showReAuth && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Update Authentication
              </CardTitle>
              <button
                onClick={() => {
                  setShowReAuth(false);
                  setCookieJson("");
                  setCookieError(null);
                  setCapturedCount(0);
                  setShowManualPaste(false);
                  setCredUsername("");
                  setCredPassword("");
                  setCredError(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {portal.authMethod === "COOKIES" ? (
              <>
                {extensionDetected ? (
                  /* Extension available — show capture button flow */
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Use the Chrome Extension to capture cookies from your active browser session.
                      Navigate to the portal first, then click &quot;Capture Cookies&quot;.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(portal.baseUrl, "_blank")}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open Portal
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCaptureCookies}
                        disabled={capturingCookies}
                      >
                        {capturingCookies ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Capture Cookies from Browser
                      </Button>
                      {capturedCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600">
                          <Check className="h-3 w-3" />
                          {capturedCount} cookies captured
                        </span>
                      )}
                    </div>
                    {cookieError && <p className="text-xs text-destructive">{cookieError}</p>}
                    {capturedCount > 0 && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={saveCookies}
                          disabled={cookieSaving}
                        >
                          {cookieSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Save Cookies
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowReAuth(false);
                            setCookieJson("");
                            setCapturedCount(0);
                            setCookieError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                    <button
                      onClick={() => setShowManualPaste(!showManualPaste)}
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      {showManualPaste ? "Hide manual paste" : "Paste manually instead"}
                    </button>
                    {showManualPaste && (
                      <div className="space-y-2">
                        <Textarea
                          value={cookieJson}
                          onChange={(e) => setCookieJson(e.target.value)}
                          placeholder={`[{"name":"session_id","value":"abc123","domain":".portal.com","path":"/"}]`}
                          className="h-28 resize-none font-mono text-xs"
                        />
                        {capturedCount === 0 && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={saveCookies}
                              disabled={cookieSaving || !cookieJson.trim()}
                            >
                              {cookieSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                              Save Cookies
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* No extension — show paste flow directly */
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Paste your cookie JSON below. Export from browser DevTools (Application →
                      Cookies) or use a cookie export extension.
                    </p>
                    <Textarea
                      value={cookieJson}
                      onChange={(e) => setCookieJson(e.target.value)}
                      placeholder={`[{"name":"session_id","value":"abc123","domain":".portal.com","path":"/","httpOnly":true,"secure":true}]`}
                      className="h-32 resize-none font-mono text-xs"
                    />
                    {cookieError && <p className="text-xs text-destructive">{cookieError}</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={saveCookies}
                        disabled={cookieSaving || !cookieJson.trim()}
                      >
                        {cookieSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Save Cookies
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowReAuth(false);
                          setCookieJson("");
                          setCookieError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Update the login credentials used to authenticate with this portal.
                </p>
                <div className="grid gap-2 max-w-sm">
                  <Input
                    placeholder="Username / Email"
                    value={credUsername}
                    onChange={(e) => setCredUsername(e.target.value)}
                    autoComplete="username"
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === "Enter" && saveCredentials()}
                  />
                </div>
                {credError && <p className="text-xs text-destructive">{credError}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={saveCredentials}
                    disabled={credSaving || !credUsername.trim() || !credPassword.trim()}
                  >
                    {credSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Save Credentials
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowReAuth(false);
                      setCredUsername("");
                      setCredPassword("");
                      setCredError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Comparison Setup */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Comparison Setup</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure how the AI compares scraped portal data against your uploaded documents.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={
              showImport
                ? () => {
                    setShowImport(false);
                    setImportError(null);
                  }
                : openImport
            }
            className="mt-0.5 h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {showImport ? "Cancel" : "Copy from portal"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Import panel */}
          {showImport && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Copy comparison setup from another portal
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Copies the grouping field and all comparison rules. This will replace the current
                  setup on this portal.
                </p>
              </div>
              {importLoadingPortals ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading portals…
                </div>
              ) : importPortals.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No other portals available to copy from.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={importSourceId}
                    onChange={(e) => {
                      setImportSourceId(e.target.value);
                      setImportError(null);
                    }}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select source portal…</option>
                    {importPortals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={executeImport}
                    disabled={!importSourceId || importing || importDone}
                    className="h-8 shrink-0 text-xs"
                  >
                    {importDone ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Import"
                    )}
                  </Button>
                </div>
              )}
              {importError && <p className="text-xs text-destructive">{importError}</p>}
            </div>
          )}

          <GroupingFieldConfig
            portalId={portal.id}
            currentGroupingFields={portal.groupingFields}
            availableFields={portal.availableFields}
            detectedClaimTypes={portal.detectedClaimTypes}
            onSaved={() => router.refresh()}
          />
          <div className="border-t border-border pt-5">
            <TemplateList
              portalId={portal.id}
              groupingField={portal.groupingFields[0] ?? null}
              detectedClaimTypes={portal.detectedClaimTypes}
              availableFields={portal.availableFields}
            />
          </div>
        </CardContent>
      </Card>

      {/* Scrape Sessions */}
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
                        (new Date(s.completedAt).getTime() -
                          new Date(s.startedAt).getTime()) /
                          1000
                      )
                    : null;

                const total = s.itemsFound || 0;
                const TERMINAL_STATUSES = [
                  "COMPARED",
                  "FLAGGED",
                  "VERIFIED",
                  "ERROR",
                  "SKIPPED",
                ] as const;
                const processed = TERMINAL_STATUSES.reduce(
                  (sum, st) => sum + (s.itemStatusCounts[st] ?? 0),
                  0
                );
                const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
                const isRunning = s.status === "RUNNING" || s.status === "PENDING";

                const statusEntries = STATUS_ORDER.filter(
                  (st) => (s.itemStatusCounts[st] ?? 0) > 0
                ).map((st) => ({ status: st, count: s.itemStatusCounts[st] }));

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
                          <span
                            className="text-xs text-muted-foreground"
                            suppressHydrationWarning
                          >
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
    </div>
  );
}
