"use client";

import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtractionState } from "@/types/extraction";

interface ExtractionStatusProps {
  status: ExtractionState;
  fieldCount?: number;
  error?: string;
}

export function ExtractionStatus({ status, fieldCount, error }: ExtractionStatusProps) {
  if (status === "idle") return null;

  if (status === "processing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Extracting fields from document...</span>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-status-success" />
        <Badge variant="success">
          {fieldCount} field{fieldCount !== 1 ? "s" : ""} extracted
        </Badge>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-center gap-2">
        <XCircle className="h-4 w-4 text-status-error" />
        <Badge variant="error">Extraction failed</Badge>
        {error && <span className="text-xs text-muted-foreground">{error}</span>}
      </div>
    );
  }

  return null;
}
