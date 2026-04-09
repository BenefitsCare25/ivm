"use client";

import { useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GroupingFieldConfigProps {
  portalId: string;
  currentGroupingFields: string[];
  availableFields: string[];
  onSaved: () => void;
}

export function GroupingFieldConfig({
  portalId,
  currentGroupingFields,
  availableFields,
  onSaved,
}: GroupingFieldConfigProps) {
  const [selected, setSelected] = useState<string[]>(currentGroupingFields);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affectedTemplateCount, setAffectedTemplateCount] = useState(0);
  const [showAffectedWarning, setShowAffectedWarning] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/grouping-fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupingFields: selected }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setEditing(false);
      if (data.affectedTemplateCount > 0) {
        setAffectedTemplateCount(data.affectedTemplateCount);
        setShowAffectedWarning(true);
      }
      onSaved();
    } catch {
      setError("Failed to save grouping fields");
    } finally {
      setSaving(false);
    }
  }

  function toggleField(field: string) {
    if (selected.length >= 5 && !selected.includes(field)) return;
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Claim Type Detection</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Configure
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {currentGroupingFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Select which scraped fields identify the type of each item (e.g. &ldquo;Claim Type&rdquo;). After
              scraping, you&apos;ll set comparison rules per detected type.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {currentGroupingFields.map((f) => (
                  <Badge key={f} variant="secondary">
                    {f}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Items will be grouped by these fields. Run a scrape to detect claim types and
                configure comparison rules.
              </p>
            </>
          )}
          {showAffectedWarning && (
            <div className="flex items-start gap-2 rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              <span className="flex-1">
                ⚠ {affectedTemplateCount} existing template{affectedTemplateCount > 1 ? "s" : ""} may
                no longer match items. Consider reviewing or deleting them.
              </span>
              <button onClick={() => setShowAffectedWarning(false)} className="hover:opacity-70">✕</button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Claim Type Detection</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pick 1–5 fields whose values distinguish item types. Each unique combination becomes a
          comparison template.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {availableFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fields available. Run a scrape first to discover field names.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableFields.map((f) => (
              <button
                key={f}
                onClick={() => toggleField(f)}
                disabled={selected.length >= 5 && !selected.includes(f)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected.includes(f)
                    ? "border-accent bg-accent/10 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setSelected(currentGroupingFields);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
