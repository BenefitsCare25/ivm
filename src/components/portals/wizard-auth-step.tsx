"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Cookie, KeyRound, AlertTriangle,
  ExternalLink, ChevronDown, CheckCircle2, RefreshCw,
} from "lucide-react";
import { detectExtension, captureCookiesFromExtension, syncExtensionConfig, mapChromeCookies } from "@/lib/extension";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "";
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

interface WizardAuthStepProps {
  baseUrl: string;
  authMethod: "COOKIES" | "CREDENTIALS";
  setAuthMethod: (m: "COOKIES" | "CREDENTIALS") => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  cookieJson: string;
  setCookieJson: (v: string) => void;
  capturedCount: number | null;
  setCapturedCount: (v: number | null) => void;
  setError: (v: string | null) => void;
}

export function WizardAuthStep({
  baseUrl, authMethod, setAuthMethod,
  username, setUsername, password, setPassword,
  cookieJson, setCookieJson,
  capturedCount, setCapturedCount,
  setError,
}: WizardAuthStepProps) {
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [capturingCookies, setCapturingCookies] = useState(false);
  const [showManualPaste, setShowManualPaste] = useState(false);

  useEffect(() => {
    if (authMethod === "COOKIES") {
      detectExtension()
        .then(async (detected) => {
          setExtensionDetected(detected);
          if (detected) {
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
  }, [authMethod]);

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
  }, [baseUrl, setError, setCapturedCount, setCookieJson]);

  return (
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
  );
}
