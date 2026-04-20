"use client";

import { useState, useEffect } from "react";
import { Loader2, Pencil, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DetectedClaimType } from "@/types/portal";

interface GroupingFieldConfigProps {
  portalId: string;
  configId: string;
  currentGroupingFields: string[];
  availableFields: string[];
  detectedClaimTypes: DetectedClaimType[];
  onSaved: () => void;
}

export function GroupingFieldConfig({
  portalId,
  configId,
  currentGroupingFields,
  availableFields,
  detectedClaimTypes,
  onSaved,
}: GroupingFieldConfigProps) {
  const [selected, setSelected] = useState<string[]>(currentGroupingFields);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => { setSelected(currentGroupingFields); }, [currentGroupingFields]);
  const [error, setError] = useState<string | null>(null);
  const [affectedTemplateCount, setAffectedTemplateCount] = useState(0);

  function toggleField(field: string) {
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/configs/${configId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupingFields: selected }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setEditing(false);
      if (data.affectedTemplateCount > 0) {
        setAffectedTemplateCount(data.affectedTemplateCount);
      }
      onSaved();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
            1
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Claim type field</p>
            <p className="text-xs text-muted-foreground">
              Which scraped field identifies what type of claim each item is?
            </p>
          </div>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="shrink-0">
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {currentGroupingFields.length > 0 ? "Change" : "Configure"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 pl-7">
          {availableFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fields found yet. Run Field Discovery or a scrape first.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Select the fields that identify claim categories — e.g.{" "}
                <span className="font-mono text-foreground">Claim Type</span> and{" "}
                <span className="font-mono text-foreground">Sub Claim Type</span>. Avoid unique
                fields like Claim ID.
              </p>
              <div className="flex flex-wrap gap-2">
                {availableFields.map((f) => (
                  <label
                    key={f}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      selected.includes(f)
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(f)}
                      onChange={() => toggleField(f)}
                      className="sr-only"
                    />
                    {selected.includes(f) ? "✓ " : ""}
                    {f}
                  </label>
                ))}
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || selected.length === 0}>
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
        </div>
      ) : (
        <div className="pl-7 space-y-2">
          {currentGroupingFields.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Not configured — run Field Discovery or pick which fields identify the claim type.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {currentGroupingFields.length === 1 ? "Field:" : "Fields:"}
                </p>
                {currentGroupingFields.map((f) => (
                  <Badge key={f} variant="secondary" className="font-mono text-xs">
                    {f}
                  </Badge>
                ))}
              </div>

              {detectedClaimTypes.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Claim type combinations found:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedClaimTypes.map((ct) => (
                      <span
                        key={ct.label}
                        className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        {ct.label}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground pt-0.5">
                    Each combination gets its own comparison rules in Step 2 below.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No values detected yet — run Field Discovery to find claim types.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {affectedTemplateCount > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <span className="flex-1">
            ⚠ {affectedTemplateCount} existing template
            {affectedTemplateCount > 1 ? "s" : ""} in Step 2 may no longer match. Review or delete
            them below.
          </span>
          <button onClick={() => setAffectedTemplateCount(0)} className="hover:opacity-70">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
