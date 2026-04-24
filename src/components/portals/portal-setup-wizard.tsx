"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, ArrowLeft, Check, Sparkles } from "lucide-react";
import { WizardAuthStep } from "./wizard-auth-step";
import type { ListSelectors, DetailSelectors } from "@/types/portal";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "";
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
  } catch (err) {
    console.warn("[portal-wizard] Failed to restore wizard state from sessionStorage", err);
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
  const [capturedCount, setCapturedCount] = useState<number | null>(null);

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
            <WizardAuthStep
              baseUrl={baseUrl}
              authMethod={authMethod}
              setAuthMethod={setAuthMethod}
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              cookieJson={cookieJson}
              setCookieJson={setCookieJson}
              capturedCount={capturedCount}
              setCapturedCount={setCapturedCount}
              setError={setError}
            />
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
                  <Card className="overflow-hidden">
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
                  </Card>
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
