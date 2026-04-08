"use client";

import { useState, useCallback } from "react";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import type { TargetAssetData } from "@/types/target";

interface TargetUrlInputProps {
  sessionId: string;
  onComplete: (target: TargetAssetData) => void;
  onBack: () => void;
}

export function TargetUrlInput({ sessionId, onComplete, onBack }: TargetUrlInputProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleInspect = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "WEBPAGE", url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to inspect webpage");
      }

      const target: TargetAssetData = await res.json();
      onComplete(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inspect webpage");
    } finally {
      setLoading(false);
    }
  }, [url, sessionId, onComplete]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <span className="text-sm text-muted-foreground">
          Enter the webpage URL to inspect
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://example.com/form"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleInspect()}
          disabled={loading}
          className="flex-1"
        />
        <Button onClick={handleInspect} disabled={loading || !url.trim()}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          {loading ? "Inspecting..." : "Inspect"}
        </Button>
      </div>

      <FormError message={error} />
    </div>
  );
}
