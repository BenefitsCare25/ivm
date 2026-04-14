"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, ExternalLink, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  detectExtension,
  captureCookiesFromExtension,
  mapChromeCookies,
  type ExtensionCookie,
} from "@/lib/extension";

interface PortalAuthPanelProps {
  portalId: string;
  authMethod: string;
  baseUrl: string;
  onClose: () => void;
  onSaved: () => void;
}

export function PortalAuthPanel({
  portalId,
  authMethod,
  baseUrl,
  onClose,
  onSaved,
}: PortalAuthPanelProps) {
  const router = useRouter();
  const isCookies = authMethod === "COOKIES";

  const [cookieJson, setCookieJson] = useState("");
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [capturingCookies, setCapturingCookies] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [showManualPaste, setShowManualPaste] = useState(false);

  useEffect(() => {
    if (!isCookies) return;
    detectExtension().then((detected) => {
      setExtensionDetected(detected);
      if (detected) {
        setShowManualPaste(false);
        setCapturedCount(0);
      }
    });
  }, [isCookies]);

  function handleClose() {
    setCookieJson("");
    setCookieError(null);
    setCookieSaving(false);
    setCapturedCount(0);
    setCapturingCookies(false);
    setShowManualPaste(false);
    setCredUsername("");
    setCredPassword("");
    setCredError(null);
    setCredSaving(false);
    onClose();
  }

  async function handleCaptureCookies() {
    setCapturingCookies(true);
    setCookieError(null);
    try {
      const cookies = await captureCookiesFromExtension(baseUrl);
      const mapped = mapChromeCookies(cookies);
      setCookieJson(JSON.stringify(mapped, null, 2));
      setCapturedCount(mapped.length);
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : "Failed to capture cookies");
    } finally {
      setCapturingCookies(false);
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
      const res = await fetch(`/api/portals/${portalId}/cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: parsed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save cookies");
      }
      onSaved();
      router.refresh();
      handleClose();
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
      const res = await fetch(`/api/portals/${portalId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: credUsername, password: credPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save credentials");
      }
      onSaved();
      router.refresh();
      handleClose();
    } catch (err) {
      setCredError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setCredSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Update Authentication
          </CardTitle>
          <button
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isCookies ? (
          <>
            {extensionDetected ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Use the Chrome Extension to capture cookies from your active browser session.
                  Navigate to the portal first, then click &quot;Capture Cookies&quot;.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(baseUrl, "_blank")}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Open Portal
                  </Button>
                  <Button size="sm" onClick={handleCaptureCookies} disabled={capturingCookies}>
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
                    <Button size="sm" onClick={saveCookies} disabled={cookieSaving}>
                      {cookieSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save Cookies
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClose}>
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
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Paste your cookie JSON below. Export from browser DevTools (Application → Cookies)
                  or use a cookie export extension.
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
                  <Button variant="ghost" size="sm" onClick={handleClose}>
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
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
