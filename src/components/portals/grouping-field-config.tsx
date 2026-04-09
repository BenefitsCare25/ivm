"use client";

import { useState } from "react";
import { Loader2, Pencil, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface GroupingFieldConfigProps {
  portalId: string;
  currentGroupingFields: string[];
  availableFields: string[];
  detectedClaimTypes: string[];
  onSaved: () => void;
}

export function GroupingFieldConfig({
  portalId,
  currentGroupingFields,
  availableFields,
  detectedClaimTypes,
  onSaved,
}: GroupingFieldConfigProps) {
  // Single field — we store as array internally for API compatibility
  const currentField = currentGroupingFields[0] ?? "";
  const [selected, setSelected] = useState<string>(currentField);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affectedTemplateCount, setAffectedTemplateCount] = useState(0);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/grouping-fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupingFields: selected ? [selected] : [] }),
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
            {currentField ? "Change" : "Configure"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 pl-7">
          {availableFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fields found yet. Run a scrape first — field names are discovered automatically.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Pick the field whose value names the claim type — e.g. select{" "}
                <span className="font-mono text-foreground">Claim Type</span> if your portal shows
                values like <span className="italic">&ldquo;Group Outpatient Specialist&rdquo;</span>{" "}
                or <span className="italic">&ldquo;Inpatient&rdquo;</span>. Avoid unique fields like
                Claim ID.
              </p>
              <div className="relative">
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">— Select a field —</option>
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !selected}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setSelected(currentField);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="pl-7 space-y-2">
          {!currentField ? (
            <p className="text-sm text-muted-foreground italic">
              Not configured — run a scrape first, then pick which field identifies the claim type.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Field:</p>
                <Badge variant="secondary" className="font-mono text-xs">
                  {currentField}
                </Badge>
              </div>

              {detectedClaimTypes.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Values found in scraped data:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedClaimTypes.map((v) => (
                      <span
                        key={v}
                        className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground pt-0.5">
                    Each value gets its own comparison rules in Step 2 below.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No values detected yet — run a scrape to discover claim types.
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
