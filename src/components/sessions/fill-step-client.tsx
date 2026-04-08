"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, ArrowRight, Download, RotateCcw, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import { WebpageFillScript } from "./webpage-fill-script";
import { useDownloadFill } from "./use-download-fill";
import type { FillState, FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";
import type { FillPreviewItem } from "@/app/api/sessions/[id]/fill/preview/route";

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
  const handleDownload = useDownloadFill(sessionId);

  const [fillState, setFillState] = useState<FillState>(() =>
    resolveInitialState(initialData)
  );
  const [fillData, setFillData] = useState<FillSessionData | null>(initialData);
  const [error, setError] = useState("");
  const [retryingFieldId, setRetryingFieldId] = useState<string | null>(null);
  const [previewItems, setFillPreviewItems] = useState<FillPreviewItem[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleExecute = useCallback(async () => {
    setFillState("processing");
    setError("");
    setShowPreview(false);

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
      setFillState("completed");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Fill execution failed";
      setError(message);
      setFillState("failed");
    }
  }, [sessionId, router]);

  const handleRetryField = useCallback(async (targetFieldId: string) => {
    setRetryingFieldId(targetFieldId);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFieldIds: [targetFieldId] }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Retry failed");
      }

      const result = await res.json();
      setFillData(result);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed";
      setError(message);
    } finally {
      setRetryingFieldId(null);
    }
  }, [sessionId, router]);

  const handlePreview = useCallback(async () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }

    if (previewItems !== null) {
      setShowPreview(true);
      return;
    }

    setPreviewLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill/preview`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load preview");
      }
      const data = await res.json();
      setFillPreviewItems(data.items ?? []);
      setShowPreview(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load preview";
      setError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId, showPreview, previewItems]);

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
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                ) : showPreview ? (
                  <EyeOff className="mr-2 h-4 w-4" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                {showPreview ? "Hide Preview" : "Preview"}
              </Button>
              <Button onClick={handleExecute}>
                <Play className="mr-2 h-4 w-4" />
                {fillState === "failed" ? "Retry Fill" : "Execute Fill"}
              </Button>
            </>
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

      {showPreview && previewItems && fillState !== "completed" && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-sm font-medium text-foreground">
              Preview — {previewItems.length} fields will be filled
            </p>
            <p className="text-xs text-muted-foreground">
              Values shown below will be written to the target
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Target Field
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Intended Value
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewItems.map((item) => (
                  <tr
                    key={item.targetFieldId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 font-medium text-foreground">
                      {item.targetLabel}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      <span
                        className="inline-block max-w-[300px] truncate"
                        title={item.intendedValue}
                      >
                        {item.intendedValue || (
                          <span className="italic text-muted-foreground/50">empty</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs ${
                          item.hasOverride
                            ? "text-amber-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {item.hasOverride ? "Override" : "Extracted"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fillState === "completed" && fillData && (
        <>
          <FillReportCard report={fillData.report} />
          {fillData.webpageFillScript && targetType === "WEBPAGE" && (
            <WebpageFillScript
              script={fillData.webpageFillScript}
              targetUrl={targetUrl}
            />
          )}
          <FillActionsTable
            actions={fillData.actions}
            onRetryField={handleRetryField}
            retryingFieldId={retryingFieldId}
          />
        </>
      )}
    </div>
  );
}
