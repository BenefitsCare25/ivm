"use client";

import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  portalId: string;
  templateId: string;
}

export function TemplatePromptPreview({ portalId, templateId }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portals/${portalId}/templates/${templateId}/prompt-preview`
      );
      if (!res.ok) throw new Error("Failed to load preview");
      const data = await res.json();
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">AI Prompt Preview</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={loadPreview}
            disabled={loading}
            className="h-7 text-xs px-2"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {preview ? "Refresh" : "Generate preview"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Shows the exact prompt sent to the AI during comparison. Placeholders replace real data.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-status-error">{error}</p>
        )}
        {!preview && !error && (
          <p className="text-xs text-muted-foreground py-6 text-center">
            Click "Generate preview" to see the AI prompt for this template.
          </p>
        )}
        {preview && (
          <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-muted/40 rounded-md p-3 max-h-96 overflow-y-auto leading-relaxed">
            {preview}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
