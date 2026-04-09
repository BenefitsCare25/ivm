"use client";

import { useState, useEffect } from "react";
import { Trash2, Loader2, FileSliders, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MATCH_MODE_LABELS } from "@/types/portal";
import type { ComparisonTemplateSummary, MatchMode, TemplateField } from "@/types/portal";

interface TemplateListProps {
  portalId: string;
}

export function TemplateList({ portalId }: TemplateListProps) {
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);

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

  function startEdit(t: ComparisonTemplateSummary) {
    setEditing(t.id);
    setEditFields(t.fields.map((f) => ({ ...f })));
  }

  function cancelEdit() {
    setEditing(null);
    setEditFields([]);
  }

  function updateEditMode(fieldName: string, mode: MatchMode) {
    setEditFields((prev) =>
      prev.map((f) =>
        f.fieldName === fieldName
          ? { ...f, mode, tolerance: mode === "numeric" ? (f.tolerance ?? 0.01) : undefined }
          : f
      )
    );
  }

  function updateEditTolerance(fieldName: string, tolerance: number) {
    setEditFields((prev) =>
      prev.map((f) => (f.fieldName === fieldName ? { ...f, tolerance } : f))
    );
  }

  async function handleSaveEdit(templateId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: editFields }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, fields: editFields } : t))
      );
      setEditing(null);
      setEditFields([]);
    } catch {
      // leave edit mode open so user can retry
    } finally {
      setSaving(false);
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
            No templates yet. After a scrape completes, you&apos;ll be prompted to configure which
            fields to compare for each detected claim type.
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editing === t.id ? cancelEdit() : startEdit(t)}
                      disabled={deleting === t.id || saving}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id || editing === t.id}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    >
                      {deleting === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(t.groupingKey).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-xs">
                      {k}: {v}
                    </Badge>
                  ))}
                </div>

                {editing === t.id ? (
                  <div className="space-y-2 pt-1">
                    {editFields.map((field) => (
                      <div
                        key={field.fieldName}
                        className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
                      >
                        <span className="flex-1 text-xs text-foreground truncate">{field.fieldName}</span>
                        <select
                          value={field.mode}
                          onChange={(e) => updateEditMode(field.fieldName, e.target.value as MatchMode)}
                          className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                        >
                          {(Object.entries(MATCH_MODE_LABELS) as [MatchMode, string][]).map(
                            ([mode, label]) => (
                              <option key={mode} value={mode}>{label}</option>
                            )
                          )}
                        </select>
                        {field.mode === "numeric" && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={field.tolerance ?? 0}
                            onChange={(e) =>
                              updateEditTolerance(field.fieldName, parseFloat(e.target.value) || 0)
                            }
                            className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                            placeholder="±"
                          />
                        )}
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={() => handleSaveEdit(t.id)} disabled={saving}>
                        {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
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
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
