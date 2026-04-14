"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TemplateField, MatchMode } from "@/types/portal";

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

export function TemplateFieldMappings({ fields: initial, saving, onSave }: Props) {
  const [fields, setFields] = useState<TemplateField[]>(initial);

  function addField() {
    setFields((prev) => [
      ...prev,
      { portalFieldName: "", documentFieldName: "", mode: "fuzzy" },
    ]);
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateField(idx: number, patch: Partial<TemplateField>) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  function handleSave() {
    const valid = fields.filter((f) => f.portalFieldName.trim() && f.documentFieldName.trim());
    onSave(valid);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Field Mappings</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addField} className="h-7 text-xs px-2">
              <Plus className="mr-1 h-3 w-3" />
              Add field
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs px-2">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Map portal field names to document field names. Only these fields will be AI-compared.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No fields configured. Add a field mapping to get started.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_1fr_80px_28px] gap-1.5 text-xs font-medium text-muted-foreground px-1">
              <span>Portal field</span>
              <span>Document field</span>
              <span>Mode</span>
              <span />
            </div>
            {fields.map((f, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_80px_28px] gap-1.5 items-center">
                <Input
                  value={f.portalFieldName}
                  onChange={(e) => updateField(idx, { portalFieldName: e.target.value })}
                  placeholder="e.g. Claim Type"
                  className="h-7 text-xs"
                />
                <Input
                  value={f.documentFieldName}
                  onChange={(e) => updateField(idx, { documentFieldName: e.target.value })}
                  placeholder="e.g. Claim Type"
                  className="h-7 text-xs"
                />
                <select
                  value={f.mode}
                  onChange={(e) => updateField(idx, { mode: e.target.value as MatchMode })}
                  className="h-7 text-xs rounded-md border border-border bg-background px-1.5 text-foreground"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeField(idx)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-status-error"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {fields.some((f) => f.mode === "numeric") && (
              <div className="space-y-1.5 mt-2 pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground">Numeric tolerances</p>
                {fields.map((f, idx) =>
                  f.mode === "numeric" ? (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground flex-1 truncate">{f.portalFieldName || `Field ${idx + 1}`}</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={f.tolerance ?? 0}
                        onChange={(e) => updateField(idx, { tolerance: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs w-24"
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
