"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MatchMode, TemplateField } from "@/types/portal";
import { MATCH_MODE_LABELS } from "@/types/portal";

interface FieldOption {
  name: string;
  source?: "page" | "pdf" | "both";
  pageValue?: string;
  pdfValue?: string;
}

function fieldSourceLabel(f: FieldOption): string {
  const src = f.source ?? (f.pageValue != null && f.pdfValue != null ? "both" : f.pageValue != null ? "page" : "pdf");
  return src === "both" ? "(page+pdf)" : `(${src})`;
}

interface ComparisonTemplateModalProps {
  portalId: string;
  groupingKey: Record<string, string>;
  suggestedName: string;
  availableFields: FieldOption[];
  onSaved: (templateId: string) => void;
  onSkip: () => void;
}

export function ComparisonTemplateModal({
  portalId,
  groupingKey,
  suggestedName,
  availableFields,
  onSaved,
  onSkip,
}: ComparisonTemplateModalProps) {
  const [selectedFields, setSelectedFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addField(name: string) {
    if (selectedFields.some((f) => f.portalFieldName === name)) return;
    setSelectedFields((prev) => [...prev, { portalFieldName: name, documentFieldName: name, mode: "fuzzy" }]);
  }

  function removeField(name: string) {
    setSelectedFields((prev) => prev.filter((f) => f.portalFieldName !== name));
  }

  function updateMode(name: string, mode: MatchMode) {
    setSelectedFields((prev) =>
      prev.map((f) =>
        f.portalFieldName === name
          ? { ...f, mode, tolerance: mode === "numeric" ? 0.01 : undefined }
          : f
      )
    );
  }

  function updateTolerance(name: string, tolerance: number) {
    setSelectedFields((prev) =>
      prev.map((f) => (f.portalFieldName === name ? { ...f, tolerance } : f))
    );
  }

  async function handleSave() {
    if (selectedFields.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestedName,
          groupingKey,
          fields: selectedFields,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to save template");
      }
      const template = await res.json();
      onSaved(template.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  const unselected = availableFields.filter(
    (f) => !selectedFields.some((s) => s.portalFieldName === f.name)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <CardHeader>
          <CardTitle className="text-base">Configure Comparison Template</CardTitle>
          <p className="text-sm text-muted-foreground">
            New claim type detected: <strong>{suggestedName}</strong>. Select which fields to
            compare and set matching rules for each.
          </p>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 space-y-4">
          {/* Grouping key display */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(groupingKey).map(([key, value]) => (
              <Badge key={key} variant="secondary">
                {key}: {value}
              </Badge>
            ))}
          </div>

          {/* Available fields to add */}
          {unselected.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Available Fields</p>
              <div className="flex flex-wrap gap-1.5">
                {unselected.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => addField(f.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    {f.name}
                    <span className="text-muted-foreground ml-0.5">
                      {(() => {
                        const src = f.source ?? (f.pageValue != null && f.pdfValue != null ? "both" : f.pageValue != null ? "page" : "pdf");
                        return `(${src === "both" ? "page+pdf" : src})`;
                      })()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected fields with rules */}
          {selectedFields.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Selected Fields ({selectedFields.length})
              </p>
              <div className="space-y-2">
                {selectedFields.map((field) => {
                  const opt = availableFields.find((f) => f.name === field.portalFieldName);
                  return (
                    <div
                      key={field.portalFieldName}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {field.portalFieldName}
                        </p>
                        {opt && (
                          <p className="text-xs text-muted-foreground truncate">
                            Page: {opt.pageValue ?? "—"} | PDF: {opt.pdfValue ?? "—"}
                          </p>
                        )}
                      </div>
                      <select
                        value={field.mode}
                        onChange={(e) => updateMode(field.portalFieldName, e.target.value as MatchMode)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {(Object.entries(MATCH_MODE_LABELS) as [MatchMode, string][]).map(
                          ([mode, label]) => (
                            <option key={mode} value={mode}>
                              {label}
                            </option>
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
                            updateTolerance(field.portalFieldName, parseFloat(e.target.value) || 0)
                          }
                          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                          placeholder="Tolerance"
                        />
                      )}
                      <button
                        onClick={() => removeField(field.portalFieldName)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedFields.length === 0 && unselected.length === 0 && (
            <p className="text-sm text-muted-foreground">No fields available to configure.</p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>

        <div className="flex items-center justify-between border-t border-border p-4">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip (use full comparison)
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={selectedFields.length === 0 || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Template ({selectedFields.length} fields)
          </Button>
        </div>
      </Card>
    </div>
  );
}
