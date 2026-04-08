"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, ArrowRight, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import { WebpageFillScript } from "./webpage-fill-script";
import type { FillState, FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";

interface FillStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  targetType: TargetType | null;
  targetUrl: string | null;
  initialData: FillSessionData | null;
}

function resolveInitialState(data: FillSessionData | null): FillState {
  if (!data) return "idle";
  if (data.actions.length > 0) return "completed";
  return "idle";
}

export function FillStepClient({
  sessionId,
  hasPrerequisites,
  targetType,
  targetUrl,
  initialData,
}: FillStepClientProps) {
  const router = useRouter();

  const [fillState, setFillState] = useState<FillState>(() =>
    resolveInitialState(initialData)
  );
  const [fillData, setFillData] = useState<FillSessionData | null>(initialData);
  const [error, setError] = useState("");
  const [webpageScript, setWebpageScript] = useState<string | null>(
    initialData?.webpageFillScript ?? null
  );

  const handleExecute = useCallback(async () => {
    setFillState("processing");
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fill execution failed");
      }

      const result = await res.json();
      setFillData(result);
      setWebpageScript(result.webpageFillScript);
      setFillState("completed");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Fill execution failed";
      setError(message);
      setFillState("failed");
    }
  }, [sessionId, router]);

  const handleDownload = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/fill/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      res.headers
        .get("Content-Disposition")
        ?.split("filename=")[1]
        ?.replace(/"/g, "") ?? "filled-document";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [sessionId]);

  if (!hasPrerequisites) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Accept field mappings first before executing fill.
        </p>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/map`)}
          >
            Go to Mapping
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {(fillState === "idle" || fillState === "failed") && (
            <span>Ready to fill {targetType?.toLowerCase()} target</span>
          )}
          {fillState === "processing" && (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Executing fill...
            </span>
          )}
          {fillState === "completed" && fillData && (
            <span>
              Fill complete: {fillData.report.verified + fillData.report.applied}{" "}
              of {fillData.report.total} fields filled
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(fillState === "idle" || fillState === "failed") && (
            <Button onClick={handleExecute}>
              <Play className="mr-2 h-4 w-4" />
              {fillState === "failed" ? "Retry Fill" : "Execute Fill"}
            </Button>
          )}
          {fillState === "completed" && (
            <>
              <Button variant="outline" size="sm" onClick={handleExecute}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Re-fill
              </Button>
              {fillData?.hasFilledDocument && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              )}
              <Button
                onClick={() => {
                  router.push(`/sessions/${sessionId}/review`);
                  router.refresh();
                }}
              >
                Continue to Review
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <FormError message={error} />

      {fillState === "completed" && fillData && (
        <>
          <FillReportCard report={fillData.report} />
          {webpageScript && targetType === "WEBPAGE" && (
            <WebpageFillScript script={webpageScript} targetUrl={targetUrl} />
          )}
          <FillActionsTable actions={fillData.actions} />
        </>
      )}
    </div>
  );
}
