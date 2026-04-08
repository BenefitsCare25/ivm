"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, ArrowLeft, Check, Sparkles, Cookie, KeyRound } from "lucide-react";
import type { ListSelectors, DetailSelectors } from "@/types/portal";

type WizardStep = "url" | "auth" | "analyze" | "selectors" | "save";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "url", label: "Portal URL" },
  { key: "auth", label: "Authentication" },
  { key: "analyze", label: "AI Analysis" },
  { key: "selectors", label: "Confirm Selectors" },
  { key: "save", label: "Save" },
];

export function PortalSetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("url");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: URL
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [listPageUrl, setListPageUrl] = useState("");

  // Step 2: Auth
  const [authMethod, setAuthMethod] = useState<"COOKIES" | "CREDENTIALS">("COOKIES");
  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Step 3-4: Analysis results
  const [portalId, setPortalId] = useState<string | null>(null);
  const [listSelectors, setListSelectors] = useState<ListSelectors>({});
  const [detailSelectors, setDetailSelectors] = useState<DetailSelectors>({});
  const [pageType, setPageType] = useState<string>("");

  const currentIdx = STEPS.findIndex((s) => s.key === step);

  async function createPortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          baseUrl,
          listPageUrl: listPageUrl || undefined,
          authMethod,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create portal");
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
          body: JSON.stringify({ loginUrl, username, password }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || "Failed to save credentials");
        }
      }
      // For cookies, user will use Chrome Extension from the portal detail page
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
        throw new Error(data.message || "Analysis failed");
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
        throw new Error(data.message || "Failed to save selectors");
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
        setStep("save");
      } else if (step === "save") {
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
                    <label className="text-sm font-medium text-foreground">Login Page URL</label>
                    <Input
                      placeholder="https://portal.example.com/login"
                      value={loginUrl}
                      onChange={(e) => setLoginUrl(e.target.value)}
                    />
                  </div>
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
                <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                  <p>
                    After setup, use the Chrome Extension to capture cookies from your
                    logged-in browser session. You can do this from the portal detail page.
                  </p>
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

          {step === "save" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success/10">
                <Check className="h-6 w-6 text-status-success" />
              </div>
              <div className="text-center">
                <h3 className="text-sm font-medium text-foreground">Portal configured</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your portal is ready. You can trigger a scrape from the portal detail page.
                </p>
              </div>
            </div>
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
              {step === "save" ? "Go to Portal" : "Next"}
              {step !== "save" && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
