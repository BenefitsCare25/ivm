"use client";

import { useState } from "react";
import { Filter, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { TagInput } from "@/components/ui/tag-input";
import type { ScrapeFilters } from "@/types/portal";

interface Props {
  portalId: string;
  initialFilters: ScrapeFilters;
}

export function ScraperFiltersCard({ portalId, initialFilters }: Props) {
  const [excludeByStatus, setExcludeByStatus] = useState<string[]>(
    initialFilters.excludeByStatus ?? []
  );
  const [excludeBySubmittedBy, setExcludeBySubmittedBy] = useState<string[]>(
    initialFilters.excludeBySubmittedBy ?? []
  );
  const [excludeByClaimType, setExcludeByClaimType] = useState<string[]>(
    initialFilters.excludeByClaimType ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addStatus(val: string) {
    if (!excludeByStatus.includes(val)) setExcludeByStatus((prev) => [...prev, val]);
  }
  function removeStatus(i: number) {
    setExcludeByStatus((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addSubmitter(val: string) {
    if (!excludeBySubmittedBy.includes(val)) setExcludeBySubmittedBy((prev) => [...prev, val]);
  }
  function removeSubmitter(i: number) {
    setExcludeBySubmittedBy((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addClaimType(val: string) {
    if (!excludeByClaimType.includes(val)) setExcludeByClaimType((prev) => [...prev, val]);
  }
  function removeClaimType(i: number) {
    setExcludeByClaimType((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/portals/${portalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scrapeFilters: { excludeByStatus, excludeBySubmittedBy, excludeByClaimType },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save filters");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  const hasFilters =
    excludeByStatus.length > 0 ||
    excludeBySubmittedBy.length > 0 ||
    excludeByClaimType.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Scrape Filters</CardTitle>
            {hasFilters && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Active
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={save}
            disabled={saving}
            className="h-7 text-xs px-3"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              "Saved"
            ) : (
              "Save"
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Items matching these values will be skipped — not scraped or processed by AI.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Exclude by Status
          </label>
          <TagInput
            tags={excludeByStatus}
            placeholder='e.g. "Pending Documents" — press Enter to add'
            onAdd={addStatus}
            onRemove={removeStatus}
          />
          <p className="text-[11px] text-muted-foreground">
            Items where the <span className="font-mono">Status</span> field matches any value above will be excluded.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Exclude by Submitted By
          </label>
          <TagInput
            tags={excludeBySubmittedBy}
            placeholder='e.g. "John Doe" — press Enter to add'
            onAdd={addSubmitter}
            onRemove={removeSubmitter}
          />
          <p className="text-[11px] text-muted-foreground">
            Items submitted by any name above will be excluded.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Exclude by Claim Type
          </label>
          <TagInput
            tags={excludeByClaimType}
            placeholder='e.g. "Outpatient" — press Enter to add'
            onAdd={addClaimType}
            onRemove={removeClaimType}
          />
          <p className="text-[11px] text-muted-foreground">
            Items where the <span className="font-mono">Claim Type</span> field matches any value above will be excluded.
          </p>
        </div>

        {error && <FormError message={error} />}
      </CardContent>
    </Card>
  );
}
