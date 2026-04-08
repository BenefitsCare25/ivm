"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { ExtractionStatus } from "./extraction-status";
import { ExtractionTable } from "./extraction-table";
import type { ExtractedField, ExtractionState } from "@/types/extraction";

interface ExtractionData {
  id: string;
  status: string;
  documentType: string | null;
  fields: ExtractedField[];
  errorMessage: string | null;
}

interface ExtractStepClientProps {
  sessionId: string;
  hasSource: boolean;
  initialExtraction: ExtractionData | null;
}

export function ExtractStepClient({ sessionId, hasSource, initialExtraction }: ExtractStepClientProps) {
  const router = useRouter();

  const [extractionState, setExtractionState] = useState<ExtractionState>(() => {
    if (!initialExtraction) return "idle";
    if (initialExtraction.status === "COMPLETED") return "completed";
    if (initialExtraction.status === "FAILED") return "failed";
    return "idle";
  });

  const [extraction, setExtraction] = useState<ExtractionData | null>(initialExtraction);
  const [fields, setFields] = useState<ExtractedField[]>(
    (initialExtraction?.fields as ExtractedField[]) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleExtract = useCallback(async () => {
    setExtractionState("processing");
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/extract`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Extraction failed");
      }

      const result = await res.json();
      setExtraction(result);
      setFields((result.fields as ExtractedField[]) ?? []);
      setExtractionState("completed");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setError(message);
      setExtractionState("failed");
    }
  }, [sessionId, router]);

  const handleSave = useCallback(async () => {
    if (!extraction) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/extraction/${extraction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save changes");
      }

      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [extraction, fields, sessionId, router]);

  if (!hasSource) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Upload a source document first before extracting fields.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => router.push(`/sessions/${sessionId}/source`)}
        >
          Go to Source Upload
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <ExtractionStatus
          status={extractionState}
          fieldCount={fields.length}
          error={extraction?.errorMessage ?? error}
        />

        {(extractionState === "idle" || extractionState === "failed") && (
          <Button onClick={handleExtract}>
            <Sparkles className="mr-2 h-4 w-4" />
            {extractionState === "failed" ? "Retry Extraction" : "Extract Fields"}
          </Button>
        )}
      </div>

      <FormError message={error} />

      {extractionState === "completed" && fields.length > 0 && (
        <>
          {extraction?.documentType && (
            <p className="text-sm text-muted-foreground">
              Document type: <span className="font-medium text-foreground">{extraction.documentType}</span>
            </p>
          )}

          <ExtractionTable fields={fields} onFieldsChange={setFields} />

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>

            <Button onClick={() => router.push(`/sessions/${sessionId}/target`)}>
              Continue to Target
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
