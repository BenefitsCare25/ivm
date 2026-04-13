"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, ArrowLeft, Check, Sparkles, Cookie, KeyRound, AlertTriangle, ExternalLink, ChevronDown, CheckCircle2, RefreshCw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { detectExtension, captureCookiesFromExtension, syncExtensionConfig, mapChromeCookies } from "@/lib/extension";
import type { ExtensionCookie } from "@/lib/extension";
import type { ListSelectors, DetailSelectors } from "@/types/portal";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

type WizardStep = "url" | "auth" | "analyze" | "selectors";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "url", label: "Portal URL" },
  { key: "auth", label: "Authentication" },
  { key: "analyze", label: "AI Analysis" },
  { key: "selectors", label: "Confirm Selectors" },
];

const WIZARD_KEY = "ivm_portal_wizard";

function loadWizard() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WIZARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function PortalSetupWizard() {
  const router = useRouter();

  // All state initializes to SSR-safe defaults. sessionStorage is restored in a
  // useEffect after mount so server and client initial renders always match
  // (fixes React hydration error #418 from accessing sessionStorage during SSR).
  const [step, setStep] = useState<WizardStep>("url");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: URL
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [listPageUrl, setListPageUrl] = useState("");

  // Step 2: Auth
  const [authMethod, setAuthMethod] = useState<"COOKIES" | "CREDENTIALS">("COOKIES");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cookieJson, setCookieJson] = useState("");
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [capturingCookies, setCapturingCookies] = useState(false);
  const [capturedCount, setCapturedCount] = useState<number | null>(null);
  const [showManualPaste, setShowManualPaste] = useState(false);

  // Step 3-4: Analysis results
  const [portalId, setPortalId] = useState<string | null>(null);
  const [listSelectors, setListSelectors] = useState<ListSelectors>({});
  const [detailSelectors, setDetailSelectors] = useState<DetailSelectors>({});
  const [pageType, setPageType] = useState<string>("");

  // Restore persisted wizard state after mount (client-only, avoids SSR mismatch).
  useEffect(() => {
    const saved = loadWizard();
    if (!saved) return;
    if (saved.step) setStep(saved.step);
    if (saved.name) setName(saved.name);
    if (saved.baseUrl) setBaseUrl(saved.baseUrl);
    if (saved.listPageUrl) setListPageUrl(saved.listPageUrl);
    if (saved.authMethod) setAuthMethod(saved.authMethod);
    if (saved.username) setUsername(saved.username);
    if (saved.password) setPassword(saved.password);
    if (saved.cookieJson) setCookieJson(saved.cookieJson);
    if (saved.capturedCount != null) setCapturedCount(saved.capturedCount);
    if (saved.portalId) setPortalId(saved.portalId);
    if (saved.listSelectors) setListSelectors(saved.listSelectors);
    if (saved.detailSelectors) setDetailSelectors(saved.detailSelectors);
    if (saved.pageType) setPageType(saved.pageType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Persist wizard state to sessionStorage on every meaningful change.
  useEffect(() => {
    try {
      sessionStorage.setItem(WIZARD_KEY, JSON.stringify({
        step, name, baseUrl, listPageUrl,
        authMethod, username, password, cookieJson, capturedCount,
        portalId, listSelectors, detailSelectors, pageType,
      }));
    } catch { /* storage full or private mode */ }
  }, [step, name, baseUrl, listPageUrl, authMethod, username, password, cookieJson, capturedCount, portalId, listSelectors, detailSelectors, pageType]);

  const currentIdx = STEPS.findIndex((s) => s.key === step);

  // Detect Chrome extension when entering auth step with cookies method
  useEffect(() => {
    if (step === "auth" && authMethod === "COOKIES") {
      detectExtension()
        .then(async (detected) => {
          setExtensionDetected(detected);
          if (detected) {
            // Sync IVM config (base URL + userId) to extension storage for popup auth.
            // Fetch session to get userId — lightweight call, cached by Next.js.
            try {
              const res = await fetch("/api/auth/session");
              if (res.ok) {
                const data = await res.json();
                if (data?.user?.id) {
                  await syncExtensionConfig(data.user.id);
                }
              }
            } catch { /* non-critical */ }
          }
        })
        .catch(() => setExtensionDetected(false));
    }
  }, [step, authMethod]);

  const handleCaptureCookies = useCallback(async () => {
    if (!baseUrl.trim()) return;
    setCapturingCookies(true);
    setError(null);
    setCapturedCount(null);
    try {
      const normalizedBase = normalizeUrl(baseUrl);
      const cookies = await captureCookiesFromExtension(normalizedBase);
      const mapped = mapChromeCookies(cookies);
      setCookieJson(JSON.stringify(mapped, null, 2));
      setCapturedCount(mapped.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture cookies from extension");
    } finally {
      setCapturingCookies(false);
    }
  }, [baseUrl]);

  function apiError(data: Record<string, unknown>, fallback: string): string {
    return (data.error as string) || (data.message as string) || fallback;
  }

  async function createPortal() {
    setLoading(true);
    setError(null);
    const normalizedBase = normalizeUrl(baseUrl);
    const normalizedList = normalizeUrl(listPageUrl);
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          baseUrl: normalizedBase,
          listPageUrl: normalizedList || undefined,
          authMethod,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(apiError(data, "Failed to create portal"));
      }
      const portal = await res.json();
      setPortalId(portal.id);
      return portal.id as string;
    } finally {
      setLoading(false);
    }
  }

  async function saveAuth(id: string) {
    setLoading(true);
    setError(null);
    try {
      if (authMethod === "CREDENTIALS") {
        const res = await fetch(`/api/portals/${id}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(apiError(data, "Failed to save credentials"));
        }
      } else if (authMethod === "COOKIES" && cookieJson.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(cookieJson.trim());
        } catch {
          throw new Error("Invalid cookie JSON — paste a valid JSON array of cookie objects");
        }
        const res = await fetch(`/api/portals/${id}/cookies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookies: parsed }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(apiError(data, "Failed to save cookies"));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(apiError(data, "Analysis failed"));
      }
      const data = await res.json();
      setListSelectors(data.listSelectors ?? {});
      setDetailSelectors(data.detailSelectors ?? {});
      setPageType(data.pageType ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function saveSelectors(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${id}/selectors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listSelectors, detailSelectors }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(apiError(data, "Failed to save selectors"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    setError(null);
    try {
      if (step === "url") {
        if (!name.trim() || !baseUrl.trim()) {
          setError("Name and base URL are required");
          return;
        }
        const id = await createPortal();
        if (id) setStep("auth");
      } else if (step === "auth") {
        if (authMethod === "CREDENTIALS" && (!username || !password)) {
          setError("Username and password are required for credential auth");
          return;
        }
        if (portalId) await saveAuth(portalId);
        setStep("analyze");
      } else if (step === "analyze") {
        if (portalId) await runAnalysis(portalId);
        setStep("selectors");
      } else if (step === "selectors") {
        if (portalId) await saveSelectors(portalId);
        sessionStorage.removeItem(WIZARD_KEY);
        router.push(`/portals/${portalId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  return (
    <div className="space-y-4">
      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                i < currentIdx
                  ? "bg-primary text-primary-foreground"
                  : i === currentIdx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < currentIdx ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={`text-xs ${i === currentIdx ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {step === "url" && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Portal Name</label>
                <Input
                  placeholder="e.g., Inspro Claims Portal"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Base URL</label>
                <Input
                  placeholder="https://portal.example.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  List Page URL <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  placeholder="https://portal.example.com/claims"
                  value={listPageUrl}
                  onChange={(e) => setListPageUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If different from the base URL. This is the page with the items table.
                </p>
              </div>
            </>
          )}

          {step === "auth" && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Authentication Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAuthMethod("COOKIES")}
                    className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                      authMethod === "COOKIES"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Cookie className="h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-foreground">Chrome Extension</div>
                      <div className="text-xs text-muted-foreground">Capture cookies from browser</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod("CREDENTIALS")}
                    className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                      authMethod === "CREDENTIALS"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <KeyRound className="h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-foreground">Login Credentials</div>
                      <div className="text-xs text-muted-foreground">Automated Playwright login</div>
                    </div>
                  </button>
                </div>
              </div>

              {authMethod === "CREDENTIALS" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Username</label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Password</label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </>
              )}

              {authMethod === "COOKIES" && (
                <div className="space-y-3">
                  {extensionDetected ? (
                    <>
                      {/* Primary flow: one-click capture */}
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Login to your portal in Chrome, then capture your session cookies with one click.
                        </p>

                        <div className="flex items-center gap-2">
                          {!capturedCount && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(normalizeUrl(baseUrl), "_blank")}
                              disabled={!baseUrl.trim()}
                            >
                              <ExternalLink className="mr-2 h-3.5 w-3.5" />
                              Open Portal in New Tab
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleCaptureCookies}
                            disabled={capturingCookies || !baseUrl.trim()}
                          >
                            {capturingCookies ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : capturedCount ? (
                              <RefreshCw className="mr-2 h-3.5 w-3.5" />
                            ) : (
                              <Cookie className="mr-2 h-3.5 w-3.5" />
                            )}
                            {capturedCount ? "Re-capture Cookies" : "Capture Cookies from Browser"}
                          </Button>
                        </div>

                        {capturedCount !== null && capturedCount > 0 && (
                          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span>Captured {capturedCount} cookies from your browser session.</span>
                          </div>
                        )}

                        {capturedCount === 0 && (
                          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>No cookies found for this URL. Make sure you are logged into the portal in Chrome first.</span>
                          </div>
                        )}
                      </div>

                      {/* Collapsible manual paste fallback */}
                      <button
                        type="button"
                        onClick={() => setShowManualPaste(!showManualPaste)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronDown className={`h-3 w-3 transition-transform ${showManualPaste ? "rotate-180" : ""}`} />
                        Paste manually instead
                      </button>

                      {showManualPaste && (
                        <div className="space-y-2">
                          <Textarea
                            placeholder={`Paste cookie JSON array, e.g.:\n[{"name":"session","value":"abc123","domain":".example.com","path":"/"}]`}
                            value={cookieJson}
                            onChange={(e) => { setCookieJson(e.target.value); setCapturedCount(null); }}
                            className="font-mono text-xs h-28 resize-none"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Fallback: no extension detected */}
                      <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
                        <Cookie className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                        <span>
                          Install the <strong>IVM Chrome Extension</strong> for one-click cookie capture.
                          Without it, paste cookie JSON manually below.
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Cookie JSON <span className="text-muted-foreground">(required for AI analysis)</span>
                        </label>
                        <Textarea
                          placeholder={`Paste cookie JSON array, e.g.:\n[{"name":"session","value":"abc123","domain":".example.com","path":"/"}]`}
                          value={cookieJson}
                          onChange={(e) => setCookieJson(e.target.value)}
                          className="font-mono text-xs h-28 resize-none"
                        />
                        <p className="text-xs text-muted-foreground">
                          In Chrome: DevTools &rarr; Application &rarr; Cookies &rarr; right-click &rarr; Copy all as JSON.
                        </p>
                      </div>
                    </>
                  )}

                  {!cookieJson.trim() && !capturedCount && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Without cookies, AI analysis will navigate without authentication and may see the login page instead of your data.</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === "analyze" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Sparkles className="h-10 w-10 text-primary" />
              <div className="text-center">
                <h3 className="text-sm font-medium text-foreground">AI Page Analysis</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  AI will navigate to the portal, take a screenshot, and analyze the page
                  structure to propose CSS selectors for scraping.
                </p>
              </div>
              {!loading && (
                <p className="text-xs text-muted-foreground">
                  Click &quot;Next&quot; to start the analysis
                </p>
              )}
            </div>
          )}

          {step === "selectors" && (
            <>
              {pageType && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Detected page type:</span>
                  <Badge>{pageType}</Badge>
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">List Selectors</h4>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Table Selector</label>
                  <Input
                    value={listSelectors.tableSelector ?? ""}
                    onChange={(e) => setListSelectors({ ...listSelectors, tableSelector: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Row Selector</label>
                  <Input
                    value={listSelectors.rowSelector ?? ""}
                    onChange={(e) => setListSelectors({ ...listSelectors, rowSelector: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Detail Link Selector</label>
                  <Input
                    value={listSelectors.detailLinkSelector ?? ""}
                    onChange={(e) => setListSelectors({ ...listSelectors, detailLinkSelector: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">Detail Selectors</h4>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Download Link Selector</label>
                  <Input
                    value={detailSelectors.downloadLinkSelector ?? ""}
                    onChange={(e) => setDetailSelectors({ ...detailSelectors, downloadLinkSelector: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              {listSelectors.columns && listSelectors.columns.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">
                    Detected Columns ({listSelectors.columns.length})
                  </h4>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Selector</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listSelectors.columns.map((col, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2 text-foreground">{col.name}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{col.selector}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <FormError message={error} />

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              onClick={() => {
                const prev = STEPS[currentIdx - 1];
                if (prev) setStep(prev.key);
              }}
              disabled={currentIdx === 0 || loading}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleNext} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {step === "selectors" ? "Save & Go to Portal" : "Next"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
