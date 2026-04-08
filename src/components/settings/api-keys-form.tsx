"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Trash2, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { PROVIDER_INFO, AI_PROVIDERS, type AIProvider } from "@/lib/validations/api-key";

interface SavedKey {
  provider: string;
  keyPrefix: string;
  isActive: boolean;
  updatedAt: string;
}

interface ApiKeysState {
  keys: SavedKey[];
  preferredProvider: string | null;
}

export function ApiKeysForm() {
  const [state, setState] = useState<ApiKeysState>({ keys: [], preferredProvider: null });
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [removingProvider, setRemovingProvider] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Record<string, string>>({});

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/api-keys");
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleSave = async (provider: AIProvider) => {
    const apiKey = keyInputs[provider]?.trim();
    if (!apiKey) {
      setErrors((prev) => ({ ...prev, [provider]: "Please enter an API key" }));
      return;
    }

    setSavingProvider(provider);
    setErrors((prev) => ({ ...prev, [provider]: "" }));
    setSuccesses((prev) => ({ ...prev, [provider]: "" }));

    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [provider]: data.error || "Failed to save key" }));
        return;
      }

      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
      setSuccesses((prev) => ({ ...prev, [provider]: "Key validated and saved" }));
      await fetchKeys();

      setTimeout(() => setSuccesses((prev) => ({ ...prev, [provider]: "" })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [provider]: "Network error. Please try again." }));
    } finally {
      setSavingProvider(null);
    }
  };

  const handleRemove = async (provider: AIProvider) => {
    setRemovingProvider(provider);
    setErrors((prev) => ({ ...prev, [provider]: "" }));

    try {
      const res = await fetch(`/api/settings/api-keys/${provider}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setErrors((prev) => ({ ...prev, [provider]: data.error || "Failed to remove key" }));
        return;
      }
      await fetchKeys();
    } catch {
      setErrors((prev) => ({ ...prev, [provider]: "Network error. Please try again." }));
    } finally {
      setRemovingProvider(null);
    }
  };

  const handleSetPreferred = async (provider: AIProvider) => {
    try {
      const res = await fetch("/api/settings/preferred-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        setState((prev) => ({ ...prev, preferredProvider: provider }));
      }
    } catch {
      // silently fail for preference toggle
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {AI_PROVIDERS.map((provider) => {
        const info = PROVIDER_INFO[provider];
        const savedKey = state.keys.find((k) => k.provider === provider);
        const isPreferred = state.preferredProvider === provider;
        const isSaving = savingProvider === provider;
        const isRemoving = removingProvider === provider;

        return (
          <Card key={provider}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{info.name}</h3>
                  <p className="text-xs text-muted-foreground">{info.description}</p>
                </div>
                {savedKey && (
                  <button
                    onClick={() => handleSetPreferred(provider)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      isPreferred
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {isPreferred ? "Default" : "Set as default"}
                  </button>
                )}
              </div>
            </CardHeader>

            <CardContent className="pb-3">
              {savedKey ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {savedKey.keyPrefix}
                    </code>
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(provider)}
                    disabled={isRemoving}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    {isRemoving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={info.placeholder}
                    value={keyInputs[provider] || ""}
                    onChange={(e) => {
                      setKeyInputs((prev) => ({ ...prev, [provider]: e.target.value }));
                      setErrors((prev) => ({ ...prev, [provider]: "" }));
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(provider); }}
                    disabled={isSaving}
                  />
                  <Button onClick={() => handleSave(provider)} disabled={isSaving} className="shrink-0">
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      "Save Key"
                    )}
                  </Button>
                </div>
              )}
            </CardContent>

            {(errors[provider] || successes[provider]) && (
              <CardFooter className="pt-0">
                {errors[provider] && <FormError message={errors[provider]} />}
                {successes[provider] && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-500">
                    {successes[provider]}
                  </div>
                )}
              </CardFooter>
            )}
          </Card>
        );
      })}
    </div>
  );
}
