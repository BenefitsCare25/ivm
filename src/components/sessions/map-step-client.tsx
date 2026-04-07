"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { MappingReviewTable } from "./mapping-review-table";
import type { ExtractedField } from "@/types/extraction";
import type { TargetField } from "@/types/target";
import type { FieldMapping, MappingState } from "@/types/mapping";

interface MapStepClientProps {
  sessionId: string;
  hasPrerequisites: boolean;
  extractedFields: ExtractedField[];
  targetFields: TargetField[];
  initialMapping: {
    id: string;
    status: string;
    mappings: FieldMapping[];
  } | null;
}

function resolveInitialState(status: string | undefined): MappingState {
  if (!status) return "idle";
  if (status === "PROPOSED" || status === "ACCEPTED") return "completed";
  return "idle";
}

export function MapStepClient({
  sessionId,
  hasPrerequisites,
  extractedFields,
  targetFields,
  initialMapping,
}: MapStepClientProps) {
  const router = useRouter();

  const [mappingState, setMappingState] = useState<MappingState>(
    () => resolveInitialState(initialMapping?.status)
  );
  const [mappingSetId, setMappingSetId] = useState<string | null>(initialMapping?.id ?? null);
  const [localMappings, setLocalMappings] = useState<FieldMapping[]>(
    initialMapping?.mappings ?? []
  );
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  const { matchedCount, unmappedCount } = useMemo(() => {
    const matched = localMappings.filter((m) => m.sourceFieldId !== null).length;
    return { matchedCount: matched, unmappedCount: localMappings.length - matched };
  }, [localMappings]);

  const handlePropose = useCallback(async () => {
    setMappingState("processing");
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/mapping`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Mapping failed");
      }

      const result = await res.json();
      setMappingSetId(result.id);
      setLocalMappings(result.mappings ?? []);
      setMappingState("completed");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mapping failed";
      setError(message);
      setMappingState("failed");
    }
  }, [sessionId, router]);

  const handleAccept = useCallback(async () => {
    if (!mappingSetId) return;
    setAccepting(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/mapping/${mappingSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: localMappings.map((m) => ({
            id: m.id,
            userApproved: m.userApproved,
            userOverrideValue: m.userOverrideValue,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to accept mappings");
      }

      router.push(`/sessions/${sessionId}/fill`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to accept mappings";
      setError(message);
    } finally {
      setAccepting(false);
    }
  }, [mappingSetId, localMappings, sessionId, router]);

  if (!hasPrerequisites) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Complete field extraction and target selection first before proposing mappings.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/extract`)}
          >
            Go to Extraction
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sessions/${sessionId}/target`)}
          >
            Go to Target
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {(mappingState === "idle" || mappingState === "failed") && (
            <span>
              {extractedFields.length} extracted field{extractedFields.length !== 1 ? "s" : ""},{" "}
              {targetFields.length} target field{targetFields.length !== 1 ? "s" : ""}
            </span>
          )}
          {mappingState === "processing" && (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              AI is analyzing and proposing field mappings...
            </span>
          )}
          {mappingState === "completed" && (
            <span>
              {matchedCount} matched, {unmappedCount} unmapped
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(mappingState === "idle" || mappingState === "failed") && (
            <Button onClick={handlePropose}>
              <Sparkles className="mr-2 h-4 w-4" />
              {mappingState === "failed" ? "Retry Mapping" : "Propose Mappings"}
            </Button>
          )}
          {mappingState === "completed" && (
            <Button variant="outline" size="sm" onClick={handlePropose}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Re-propose
            </Button>
          )}
        </div>
      </div>

      <FormError message={error} />

      {mappingState === "completed" && localMappings.length > 0 && (
        <>
          <MappingReviewTable
            mappings={localMappings}
            onMappingsChange={setLocalMappings}
          />

          <div className="flex justify-end">
            <Button onClick={handleAccept} disabled={accepting}>
              {accepting ? "Accepting..." : "Accept & Continue"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
