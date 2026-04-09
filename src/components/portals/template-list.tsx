"use client";

import { useState, useEffect, useMemo } from "react";
import { Trash2, Loader2, FileSliders, Pencil, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MATCH_MODE_LABELS } from "@/types/portal";
import type { ComparisonTemplateSummary, MatchMode, TemplateField } from "@/types/portal";

interface TemplateListProps {
  portalId: string;
  groupingField: string | null;
  detectedClaimTypes: string[];
  availableFields: string[];
}

// Inline field selector + rule editor for creating/editing a template
function TemplateEditor({
  fields,
  availableFields,
  onChange,
}: {
  fields: TemplateField[];
  availableFields: string[];
  onChange: (fields: TemplateField[]) => void;
}) {
  const unselected = availableFields.filter(
    (f) => !fields.some((s) => s.fieldName === f)
  );

  function addField(name: string) {
    onChange([...fields, { fieldName: name, mode: "fuzzy" }]);
  }

  function removeField(name: string) {
    onChange(fields.filter((f) => f.fieldName !== name));
  }

  function updateMode(name: string, mode: MatchMode) {
    onChange(
      fields.map((f) =>
        f.fieldName === name
          ? { ...f, mode, tolerance: mode === "numeric" ? 0.01 : undefined }
          : f
      )
    );
  }

  function updateTolerance(name: string, tolerance: number) {
    onChange(fields.map((f) => (f.fieldName === name ? { ...f, tolerance } : f)));
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Selected fields */}
      {fields.length > 0 && (
        <div className="space-y-1.5">
          {fields.map((field) => (
            <div
              key={field.fieldName}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <span className="flex-1 text-xs text-foreground truncate">{field.fieldName}</span>
              <select
                value={field.mode}
                onChange={(e) => updateMode(field.fieldName, e.target.value as MatchMode)}
                className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
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
                    updateTolerance(field.fieldName, parseFloat(e.target.value) || 0)
                  }
                  className="w-16 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
                  placeholder="±"
                />
              )}
              <button
                onClick={() => removeField(field.fieldName)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add fields */}
      {unselected.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">
            {fields.length === 0 ? "Pick fields to compare against the document:" : "Add more fields:"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unselected.map((f) => (
              <button
                key={f}
                onClick={() => addField(f)}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {fields.length === 0 && unselected.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No scraped fields available.</p>
      )}
    </div>
  );
}

export function TemplateList({
  portalId,
  groupingField,
  detectedClaimTypes,
  availableFields,
}: TemplateListProps) {
  const [templates, setTemplates] = useState<ComparisonTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Editing an existing template
  const [editing, setEditing] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Creating a template for a detected claim type
  const [creating, setCreating] = useState<string | null>(null); // claim type value
  const [newFields, setNewFields] = useState<TemplateField[]>([]);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portals/${portalId}/templates`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTemplates(data); })
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
      // leave edit open
    } finally {
      setSaving(false);
    }
  }

  function startCreate(claimTypeValue: string) {
    setCreating(claimTypeValue);
    setNewFields([]);
    setCreateError(null);
  }

  function cancelCreate() {
    setCreating(null);
    setNewFields([]);
    setCreateError(null);
  }

  async function handleSaveCreate(claimTypeValue: string) {
    if (newFields.length === 0) return;
    setCreateSaving(true);
    setCreateError(null);
    try {
      const groupingKey = groupingField ? { [groupingField]: claimTypeValue } : {};
      const res = await fetch(`/api/portals/${portalId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: claimTypeValue,
          groupingKey,
          fields: newFields,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to save template");
      }
      const created = await res.json();
      setTemplates((prev) => [...prev, created]);
      setCreating(null);
      setNewFields([]);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setCreateSaving(false);
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

  const unconfigured = detectedClaimTypes.filter((v) => !templateByValue.has(v));

  // Orphaned = has scrape data, but this template's claim type wasn't in it.
  // When there's NO scrape data yet (detectedClaimTypes empty), templates are NOT orphaned —
  // they're valid imported configs waiting for the first scrape.
  const hasScrapedData = detectedClaimTypes.length > 0;
  const orphaned = templates.filter(
    (t) => hasScrapedData && groupingField && !detectedClaimTypes.includes(t.groupingKey[groupingField] ?? "")
  );

  // Templates to show as "active" when no scrape data yet (e.g. imported from another portal)
  const preScrapedTemplates = !hasScrapedData ? templates : [];

  if (loading) {
    return (
      <div className="py-4 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step header */}
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
        {/* No scrape yet, no templates */}
        {!hasScrapedData && templates.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            {groupingField
              ? `No scraped data yet. Run a scrape — the system will detect distinct "${groupingField}" values and list them here.`
              : "Configure Step 1 first, then run a scrape to detect claim types."}
          </p>
        )}

        {/* Templates imported before first scrape — show them as active configs */}
        {preScrapedTemplates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Configured (run a scrape to match against live claim types):
            </p>
            {preScrapedTemplates.map((t) => {
              const isEditing = editing === t.id;
              return (
                <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
                      <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(t)}
                          disabled={deleting === t.id}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
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
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex flex-wrap gap-1">
                      {t.fields.map((f) => (
                        <span
                          key={f.fieldName}
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {f.fieldName}
                          <span className="opacity-60">
                            ({MATCH_MODE_LABELS[f.mode as MatchMode]?.split(" ")[0] ?? f.mode}
                            {f.mode === "numeric" && f.tolerance != null ? ` ±${f.tolerance}` : ""})
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {isEditing && (
                    <>
                      <TemplateEditor
                        fields={editFields}
                        availableFields={availableFields}
                        onChange={setEditFields}
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => handleSaveEdit(t.id)} disabled={saving || editFields.length === 0}>
                          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Detected claim types */}
        {detectedClaimTypes.map((claimValue) => {
          const template = templateByValue.get(claimValue);
          const isEditing = editing === template?.id;
          const isCreating = creating === claimValue;

          return (
            <div
              key={claimValue}
              className="rounded-lg border border-border p-3 space-y-2"
            >
              {/* Claim type header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {template ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />
                  ) : (
                    <FileSliders className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium text-foreground truncate">
                    {claimValue}
                  </span>
                  {!template && (
                    <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                      not configured
                    </Badge>
                  )}
                </div>

                {!isEditing && !isCreating && (
                  <div className="flex items-center gap-1 shrink-0">
                    {template ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(template)}
                          disabled={deleting === template.id}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
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
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startCreate(claimValue)}
                        className="h-7 text-xs"
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Configure
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Configured field pills (read mode) */}
              {template && !isEditing && (
                <div className="flex flex-wrap gap-1">
                  {template.fields.map((f) => (
                    <span
                      key={f.fieldName}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {f.fieldName}
                      <span className="opacity-60">
                        ({MATCH_MODE_LABELS[f.mode as MatchMode]?.split(" ")[0] ?? f.mode}
                        {f.mode === "numeric" && f.tolerance != null ? ` ±${f.tolerance}` : ""})
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {/* Edit existing template */}
              {isEditing && template && (
                <>
                  <TemplateEditor
                    fields={editFields}
                    availableFields={availableFields}
                    onChange={setEditFields}
                  />
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => handleSaveEdit(template.id)} disabled={saving || editFields.length === 0}>
                      {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}

              {/* Create new template */}
              {isCreating && (
                <>
                  <TemplateEditor
                    fields={newFields}
                    availableFields={availableFields}
                    onChange={setNewFields}
                  />
                  {createError && (
                    <p className="text-xs text-destructive">{createError}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleSaveCreate(claimValue)}
                      disabled={createSaving || newFields.length === 0}
                    >
                      {createSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelCreate} disabled={createSaving}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Orphaned templates (claim type no longer in recent scrapes) */}
        {orphaned.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground pt-1">
              Previously configured (not seen in recent scrapes):
            </p>
            {orphaned.map((t) => (
              <div key={t.id} className="rounded-lg border border-border border-dashed p-3 space-y-2 opacity-60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
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
                <div className="flex flex-wrap gap-1">
                  {t.fields.map((f) => (
                    <span
                      key={f.fieldName}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {f.fieldName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Unconfigured types prompt (if any detected types have no template) */}
        {unconfigured.length > 0 && !creating && (
          <p className="text-xs text-muted-foreground pt-1">
            {unconfigured.length} claim type{unconfigured.length > 1 ? "s" : ""} above{" "}
            {unconfigured.length > 1 ? "are" : "is"} not configured — click{" "}
            <span className="font-medium text-foreground">Configure</span> to set comparison rules.
          </p>
        )}
      </div>
    </div>
  );
}
