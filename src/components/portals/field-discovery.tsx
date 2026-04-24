"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, RefreshCw, Loader2, ChevronDown, ChevronUp, Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import type { DiscoveredClaimType } from "@/types/portal";
import { formatDate } from "@/lib/utils";

interface FieldDiscoveryProps {
  portalId: string;
  listColumns: string[];
  discoveredClaimTypes: DiscoveredClaimType[];
  groupingFields: string[];
}

function FieldChips({ fields }: { fields: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 8;
  const shown = expanded ? fields : fields.slice(0, limit);
  const hasMore = fields.length > limit;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((f) => (
          <span
            key={f}
            className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono text-foreground"
          >
            {f}
          </span>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> +{fields.length - limit} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

function groupingKeyLabel(key: Record<string, string>): string {
  return Object.entries(key)
    .map(([, v]) => v || "(empty)")
    .join(" / ");
}

export function FieldDiscovery({
  portalId,
  listColumns,
  discoveredClaimTypes,
  groupingFields: initialGroupingFields,
}: FieldDiscoveryProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const col of listColumns) {
      init[col] = initialGroupingFields.includes(col);
    }
    return init;
  });
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDiscoveryData = discoveredClaimTypes.length > 0;
  const selectedFields = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  async function runDiscovery() {
    if (selectedFields.length === 0) return;
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupingFields: selectedFields }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Discovery failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  const discoveredAt = discoveredClaimTypes[0]?.discoveredAt;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Search className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Field Discovery</p>
              <p className="text-xs text-muted-foreground">
                {hasDiscoveryData
                  ? <>Grouped by: {initialGroupingFields.join(", ")} &middot; Last discovered: <span suppressHydrationWarning>{formatDate(discoveredAt!)}</span></>
                  : "Discover claim types and their detail page fields before scraping."}
              </p>
            </div>
          </div>
          {hasDiscoveryData && (
            <Button
              variant="outline"
              size="sm"
              onClick={runDiscovery}
              disabled={discovering || selectedFields.length === 0}
              className="shrink-0"
            >
              {discovering ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Re-discover
            </Button>
          )}
        </div>

        {/* Grouping field selector */}
        {(!hasDiscoveryData || discovering) && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Select which list columns identify claim categories:
            </p>
            {listColumns.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No list columns configured. Set up list selectors first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {listColumns.map((col) => (
                  <label
                    key={col}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      selected[col]
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected[col] ?? false}
                      onChange={() =>
                        setSelected((prev) => ({ ...prev, [col]: !prev[col] }))
                      }
                      className="sr-only"
                    />
                    {selected[col] ? "✓ " : ""}
                    {col}
                  </label>
                ))}
              </div>
            )}

            {!hasDiscoveryData && (
              <Button
                onClick={runDiscovery}
                disabled={discovering || selectedFields.length === 0}
                size="sm"
              >
                {discovering ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                    Discover Fields
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        <FormError message={error} />

        {/* Discovery results */}
        {hasDiscoveryData && !discovering && (
          <div className="space-y-3">
            {discoveredClaimTypes.map((ct, i) => {
              const label = groupingKeyLabel(ct.groupingKey);
              return (
                <Card
                  key={i}
                  className="p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {ct.detailFields.length} fields
                      </span>
                      <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                        <Link
                          href={`/portals/${portalId}/templates?autoCreate=true&groupingKey=${encodeURIComponent(JSON.stringify(ct.groupingKey))}`}
                        >
                          <Settings className="mr-1 h-3 w-3" />
                          Configure
                        </Link>
                      </Button>
                    </div>
                  </div>
                  <FieldChips fields={ct.detailFields} />
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
