"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FillReportCard } from "./fill-report-card";
import { FillActionsTable } from "./fill-actions-table";
import { useDownloadFill } from "./use-download-fill";
import type { FillSessionData } from "@/types/fill";
import type { TargetType } from "@/types/target";

interface ReviewStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  targetType: TargetType | null;
  sessionStatus: string;
  fillData: FillSessionData | null;
}

export function ReviewStepClient({
  sessionId,
  hasPrerequisites,
  targetType,
  sessionStatus,
  fillData,
}: ReviewStepClientProps) {
  const router = useRouter();
  const handleDownload = useDownloadFill(sessionId);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(sessionStatus === "COMPLETED");
  const [error, setError] = useState("");

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to complete session");
      }

      setCompleted(true);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to complete session";
      setError(message);
    } finally {
      setCompleting(false);
    }
  }, [sessionId, router]);

  if (!hasPrerequisites || !fillData) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Complete the fill step first before reviewing.
        </p>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/fill`)}
          >
            Go to Fill
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {completed && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium text-foreground">
            Session Completed
          </p>
          <p className="text-xs text-muted-foreground">
            All fill actions have been reviewed and the session is finalized.
          </p>
        </div>
      )}

      <FillReportCard report={fillData.report} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review all fill actions below before completing the session.
        </p>
        <div className="flex items-center gap-2">
          {fillData.hasFilledDocument && targetType !== "WEBPAGE" && (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download Filled Document
            </Button>
          )}
          {!completed && (
            <Button onClick={handleComplete} disabled={completing}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {completing ? "Completing..." : "Complete Session"}
            </Button>
          )}
        </div>
      </div>

      <FormError message={error} />

      <FillActionsTable actions={fillData.actions} />
    </div>
  );
}
