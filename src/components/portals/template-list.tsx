"use client";

import { useState, useEffect } from "react";
import { Trash2, Loader2, FileSliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MATCH_MODE_LABELS } from "@/types/portal";
import type { ComparisonTemplateSummary, MatchMode } from "@/types/portal";

interface TemplateListProps {
  portalId: string;
}

export function TemplateList({ portalId }: TemplateListProps) {
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/templates`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portalId]);

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

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSliders className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">
            Comparison Templates ({templates.length})
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No templates yet. Templates are created automatically during item processing when
            grouping fields are configured.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(t.id)}
                    disabled={deleting === t.id}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    {deleting === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(t.groupingKey).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-xs">
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.fields.map((f) => (
                    <span
                      key={f.fieldName}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {f.fieldName}
                      <span className="opacity-60">
                        (
                        {MATCH_MODE_LABELS[f.mode as MatchMode]?.split(" ")[0] ?? f.mode}
                        {f.mode === "numeric" && f.tolerance != null
                          ? ` ±${f.tolerance}`
                          : ""}
                        )
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
