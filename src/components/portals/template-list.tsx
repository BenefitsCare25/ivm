"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Loader2, FileSliders, ExternalLink, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ComparisonTemplateSummary } from "@/types/portal";

function getFieldDisplayName(f: { portalFieldName?: string; fieldName?: string }, i: number): string {
  return f.portalFieldName ?? f.fieldName ?? `field-${i}`;
}

interface TemplateListProps {
  portalId: string;
  groupingField: string | null;
  detectedClaimTypes: string[];
  availableFields: string[];
  refreshKey?: number;
}

export function TemplateList({
  portalId,
  groupingField,
  detectedClaimTypes,
  availableFields: _availableFields,
  refreshKey,
}: TemplateListProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portals/${portalId}/templates`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTemplates(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portalId, refreshKey]);

  async function handleDelete(templateId: string) {
    if (!confirm("Delete this template?")) return;
    setDeleting(templateId);
    try {
      await fetch(`/api/portals/${portalId}/templates/${templateId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreate(claimValue: string) {
    setCreating(claimValue);
    try {
      const groupingKey = groupingField ? { [groupingField]: claimValue } : {};
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: claimValue, groupingKey, fields: [] }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const created = await res.json();
      router.push(`/portals/${portalId}/templates/${created.id}`);
    } catch {
      setCreating(null);
    }
  }

  const templateByValue = useMemo(() => {
    const map = new Map<string, ComparisonTemplateSummary>();
    for (const t of templates) {
      const val = groupingField ? t.groupingKey[groupingField] : null;
      if (val) map.set(val, t);
    }
    return map;
  }, [templates, groupingField]);

  const hasScrapedData = detectedClaimTypes.length > 0;
  const orphaned = templates.filter(
    (t) => hasScrapedData && groupingField && !detectedClaimTypes.includes(t.groupingKey[groupingField] ?? "")
  );
  const preScrapedTemplates = !hasScrapedData ? templates : [];

  if (loading) {
    return (
      <div className="py-4 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function TemplateRow({ t }: { t: ComparisonTemplateSummary }) {
    const fieldCount = t.fields?.length ?? 0;
    const ruleCount = (t.businessRules?.length ?? 0) + (t.requiredDocuments?.length ?? 0);
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
            <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
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
              onClick={() => handleDelete(t.id)}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
          2
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">
            Comparison rules
            {templates.length > 0 && (
              <span className="ml-1.5 text-muted-foreground font-normal">
                ({templates.length} configured)
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Which fields should the AI check against the document — per claim type
          </p>
        </div>
      </div>

      <div className="pl-7 space-y-2">
        {!hasScrapedData && templates.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            {groupingField
              ? `No scraped data yet. Run a scrape — the system will detect distinct "${groupingField}" values and list them here.`
              : "Configure Step 1 first, then run a scrape to detect claim types."}
          </p>
        )}

        {/* Templates before first scrape */}
        {preScrapedTemplates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Configured (run a scrape to match against live claim types):
            </p>
            {preScrapedTemplates.map((t) => <TemplateRow key={t.id} t={t} />)}
          </div>
        )}

        {/* Detected claim types */}
        {detectedClaimTypes.map((claimValue) => {
          const template = templateByValue.get(claimValue);
          const isCreating = creating === claimValue;
          return (
            <div key={claimValue} className="rounded-lg border border-border p-3 space-y-2">
              {template ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
                      <span className="text-sm font-medium text-foreground truncate">{template.name}</span>
                      {(() => {
                        const fc = template.fields?.length ?? 0;
                        const rc = (template.businessRules?.length ?? 0) + (template.requiredDocuments?.length ?? 0);
                        return (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {fc} field{fc !== 1 ? "s" : ""}
                            {rc > 0 && `, ${rc} rule${rc !== 1 ? "s" : ""}`}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                      >
                        <Link href={`/portals/${portalId}/templates/${template.id}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(template.id)}
                        disabled={deleting === template.id}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        {deleting === template.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {(template.fields?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {template.fields.map((f, i) => (
                        <span key={i} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {getFieldDisplayName(f as { portalFieldName?: string; fieldName?: string }, i)}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSliders className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">{claimValue}</span>
                    <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                      not configured
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCreate(claimValue)}
                    disabled={isCreating}
                    className="h-7 text-xs shrink-0"
                  >
                    {isCreating ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-1 h-3.5 w-3.5" />
                    )}
                    Configure
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* Orphaned templates */}
        {orphaned.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground pt-1">
              Previously configured (not seen in recent scrapes):
            </p>
            {orphaned.map((t) => (
              <div key={t.id} className="rounded-lg border border-border border-dashed p-3 opacity-60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                  <div className="flex items-center gap-1">
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
                      onClick={() => handleDelete(t.id)}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
