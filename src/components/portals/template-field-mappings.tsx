"use client";

import { useState } from "react";
import { Eye, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeTemplateFields } from "@/lib/comparison-reconciliation";
import type { MatchMode, TemplateField } from "@/types/portal";
import { inferDefaultMode, MAX_DOCUMENT_FIELD_ALIASES } from "@/types/portal";

const MODES: { value: MatchMode; label: string }[] = [
  { value: "fuzzy", label: "Fuzzy" },
  { value: "exact", label: "Exact" },
  { value: "numeric", label: "Numeric" },
];

interface Props {
  fields: TemplateField[];
  saving: boolean;
  onSave: (fields: TemplateField[]) => void;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function countDuplicatePortalMappings(fields: TemplateField[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const field of fields) {
    if (!field.documentFieldName.trim()) continue;
    const key = normalizeName(field.portalFieldName);
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

export function TemplateFieldMappings({ fields: initial, saving, onSave }: Props) {
  const normalizedInitial = normalizeTemplateFields(initial);
  const mergedDuplicateCount = countDuplicatePortalMappings(initial);
  const [fields, setFields] = useState<TemplateField[]>(normalizedInitial);

  const portalFieldCounts = new Map<string, number>();
  for (const field of fields) {
    const key = normalizeName(field.portalFieldName);
    if (key) portalFieldCounts.set(key, (portalFieldCounts.get(key) ?? 0) + 1);
  }
  const hasDuplicatePortalFields = [...portalFieldCounts.values()].some((count) => count > 1);
  const hasTooManyAliases = fields.some(
    (field) => (field.documentFieldAliases?.length ?? 0) > MAX_DOCUMENT_FIELD_ALIASES
  );

  function addField() {
    setFields((previous) => [
      ...previous,
      { portalFieldName: "", documentFieldName: "", mode: "fuzzy" },
    ]);
  }

  function removeField(index: number) {
    setFields((previous) => previous.filter((_, fieldIndex) => fieldIndex !== index));
  }

  function updateField(index: number, patch: Partial<TemplateField>) {
    setFields((previous) =>
      previous.map((field, fieldIndex) => {
        if (fieldIndex !== index) return field;
        const next = { ...field, ...patch };

        if (
          patch.portalFieldName !== undefined &&
          !field.portalFieldName.trim() &&
          patch.portalFieldName.trim() &&
          field.mode === "fuzzy"
        ) {
          const inferred = inferDefaultMode(patch.portalFieldName);
          next.mode = inferred.mode;
          if (inferred.tolerance !== undefined) next.tolerance = inferred.tolerance;
        }
        return next;
      })
    );
  }

  function addAlias(index: number) {
    const aliases = fields[index]?.documentFieldAliases ?? [];
    if (aliases.length >= MAX_DOCUMENT_FIELD_ALIASES) return;
    updateField(index, { documentFieldAliases: [...aliases, ""] });
  }

  function updateAlias(fieldIndex: number, aliasIndex: number, value: string) {
    const aliases = [...(fields[fieldIndex]?.documentFieldAliases ?? [])];
    aliases[aliasIndex] = value;
    updateField(fieldIndex, { documentFieldAliases: aliases });
  }

  function removeAlias(fieldIndex: number, aliasIndex: number) {
    const aliases = (fields[fieldIndex]?.documentFieldAliases ?? []).filter(
      (_, currentIndex) => currentIndex !== aliasIndex
    );
    updateField(fieldIndex, { documentFieldAliases: aliases });
  }

  function toggleVision(index: number) {
    setFields((previous) =>
      previous.map((field, fieldIndex) =>
        fieldIndex === index
          ? { ...field, verifyWithVision: !field.verifyWithVision }
          : field
      )
    );
  }

  function handleSave() {
    if (hasDuplicatePortalFields || hasTooManyAliases) return;
    onSave(normalizeTemplateFields(fields));
  }

  return (
    <Card id="field-mappings" className="scroll-mt-6">
      <CardHeader className="pb-3">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <CardTitle className="text-base">Field Mappings</CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={addField} className="h-10 px-3 text-sm 2xl:h-7 2xl:px-2 2xl:text-xs">
              <Plus className="mr-1 h-3 w-3" />
              Add field
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || hasDuplicatePortalFields || hasTooManyAliases}
              className="h-10 px-3 text-sm 2xl:h-7 2xl:px-2 2xl:text-xs"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="mr-1 h-3 w-3" />
              )}
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure each portal field once. Add document aliases when hospitals use different labels.
          Output always contains one comparison row per portal field. Amount-like fields default to{" "}
          <strong>Numeric</strong>.
        </p>
        {mergedDuplicateCount > 0 && (
          <p
            role="status"
            className="rounded-md border border-status-warning/40 bg-status-warning/10 px-2.5 py-2 text-xs text-status-warning"
          >
            Merged {mergedDuplicateCount} duplicate mapping{mergedDuplicateCount === 1 ? "" : "s"} into
            document aliases. Save to store the cleaned configuration.
          </p>
        )}
        {hasDuplicatePortalFields && (
          <p role="alert" className="text-xs text-status-error">
            Each portal field can appear only once. Add alternate document labels as aliases instead.
          </p>
        )}
        {hasTooManyAliases && (
          <p role="alert" className="text-xs text-status-error">
            A portal field can have at most {MAX_DOCUMENT_FIELD_ALIASES} aliases. Remove extra aliases before saving.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No fields configured. Add a field mapping to get started.
          </p>
        ) : (
          <>
            <div className="hidden 2xl:grid 2xl:grid-cols-[minmax(160px,1fr)_minmax(220px,1.2fr)_80px_32px_28px] 2xl:gap-1.5 2xl:px-1 text-xs font-medium text-muted-foreground">
              <span>Portal field</span>
              <span>Document fields</span>
              <span>Mode</span>
              <span title="Re-verify a mismatch or missing value against the source document with a vision model">
                Vision
              </span>
              <span />
            </div>
            {fields.map((field, index) => {
              const duplicate = (portalFieldCounts.get(normalizeName(field.portalFieldName)) ?? 0) > 1;
              const errorId = `portal-field-${index}-duplicate`;

              return (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_40px_40px] items-start gap-2 rounded-xl border border-border/60 p-3 2xl:grid-cols-[minmax(160px,1fr)_minmax(220px,1.2fr)_80px_32px_28px] 2xl:gap-1.5 2xl:rounded-none 2xl:border-0 2xl:p-0"
                >
                  <div className="col-span-3 space-y-1 2xl:col-span-1">
                    <p className="text-xs font-medium text-muted-foreground 2xl:sr-only">Portal field</p>
                    <Input
                      value={field.portalFieldName}
                      onChange={(event) => updateField(index, { portalFieldName: event.target.value })}
                      placeholder="e.g. Invoice Number"
                      aria-label={`Portal field ${index + 1}`}
                      aria-invalid={duplicate}
                      aria-describedby={duplicate ? errorId : undefined}
                      className="h-10 text-sm 2xl:h-7 2xl:text-xs"
                    />
                    {duplicate && (
                      <p id={errorId} className="text-[11px] leading-tight text-status-error">
                        Duplicate portal field
                      </p>
                    )}
                  </div>
                  <div className="col-span-3 space-y-1.5 2xl:col-span-1">
                    <p className="text-xs font-medium text-muted-foreground 2xl:sr-only">Document fields</p>
                    <Input
                      value={field.documentFieldName}
                      onChange={(event) => updateField(index, { documentFieldName: event.target.value })}
                      placeholder="Primary label, e.g. Invoice Number"
                      aria-label={`${field.portalFieldName || `Field ${index + 1}`} primary document label`}
                      className="h-10 text-sm 2xl:h-7 2xl:text-xs"
                    />
                    {(field.documentFieldAliases ?? []).map((alias, aliasIndex) => (
                      <div key={aliasIndex} className="flex items-center gap-1">
                        <Input
                          value={alias}
                          onChange={(event) => updateAlias(index, aliasIndex, event.target.value)}
                          placeholder="Alternate document label"
                          aria-label={`${field.portalFieldName || `Field ${index + 1}`} document alias ${aliasIndex + 1}`}
                          className="h-10 text-sm 2xl:h-7 2xl:text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAlias(index, aliasIndex)}
                          aria-label={`Remove document alias ${aliasIndex + 1}`}
                          className="h-10 w-10 shrink-0 p-0 text-muted-foreground hover:text-status-error 2xl:h-7 2xl:w-7"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addAlias(index)}
                      disabled={(field.documentFieldAliases?.length ?? 0) >= MAX_DOCUMENT_FIELD_ALIASES}
                      title={`Up to ${MAX_DOCUMENT_FIELD_ALIASES} alternate document labels`}
                      className="h-9 px-2 text-xs text-muted-foreground 2xl:h-6 2xl:px-1.5 2xl:text-[11px]"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add alias
                    </Button>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium text-muted-foreground 2xl:sr-only">Mode</p>
                    <select
                      value={field.mode}
                      onChange={(event) => updateField(index, { mode: event.target.value as MatchMode })}
                      aria-label={`${field.portalFieldName || `Field ${index + 1}`} comparison mode`}
                      className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground 2xl:h-7 2xl:px-1.5 2xl:text-xs"
                    >
                      {MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleVision(index)}
                    title={
                      field.verifyWithVision
                        ? "Vision re-check is on for mismatches and missing values"
                        : "Enable vision re-check for mismatches and missing values"
                    }
                    aria-label={`${field.portalFieldName || `Field ${index + 1}`} vision re-check`}
                    aria-pressed={field.verifyWithVision ?? false}
                    className={`mt-5 flex h-10 w-10 items-center justify-center rounded-md border transition-colors 2xl:mt-0 2xl:h-7 2xl:w-7 ${
                      field.verifyWithVision
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeField(index)}
                    aria-label={`Remove ${field.portalFieldName || `field ${index + 1}`}`}
                    className="mt-5 h-10 w-10 p-0 text-muted-foreground hover:text-status-error 2xl:mt-0 2xl:h-7 2xl:w-7"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
            {fields.some((field) => field.mode === "numeric") && (
              <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                <p className="text-xs font-medium text-muted-foreground">Numeric tolerances</p>
                {fields.map((field, index) =>
                  field.mode === "numeric" ? (
                    <div key={index} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        {field.portalFieldName || `Field ${index + 1}`}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={field.tolerance ?? 0}
                        onChange={(event) =>
                          updateField(index, { tolerance: Number.parseFloat(event.target.value) || 0 })
                        }
                        aria-label={`${field.portalFieldName || `Field ${index + 1}`} numeric tolerance`}
                        className="h-7 w-24 text-xs"
                        placeholder="0"
                      />
                    </div>
                  ) : null
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
