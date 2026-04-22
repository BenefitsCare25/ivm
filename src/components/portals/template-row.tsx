"use client";

import Link from "next/link";
import { Trash2, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ComparisonTemplateSummary } from "@/types/portal";

export function getFieldDisplayName(f: { portalFieldName?: string; fieldName?: string }, i: number): string {
  return f.portalFieldName ?? f.fieldName ?? `field-${i}`;
}

interface TemplateRowProps {
  t: ComparisonTemplateSummary;
  portalId: string;
  deleting: string | null;
  onDelete: (id: string) => void;
}

export function TemplateRow({ t, portalId, deleting, onDelete }: TemplateRowProps) {
  const fieldCount = t.fields?.length ?? 0;
  const ruleCount = (t.businessRules?.length ?? 0) + (t.requiredDocuments?.length ?? 0);
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
          <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
          {t.providerGroupName && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              {t.providerGroupName}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0">
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
            {ruleCount > 0 && `, ${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <Link href={`/portals/${portalId}/templates/${t.id}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Edit
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(t.id)}
            disabled={deleting === t.id}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            {deleting === t.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      {fieldCount > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.fields.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {getFieldDisplayName(f as { portalFieldName?: string; fieldName?: string }, i)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
