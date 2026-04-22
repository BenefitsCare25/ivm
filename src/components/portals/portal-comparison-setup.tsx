"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check, HelpCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { GroupingFieldConfig } from "./grouping-field-config";
import { TemplateList } from "./template-list";
import type { DetectedClaimType } from "@/types/portal";

interface PortalComparisonSetupProps {
  portalId: string;
  configId: string;
  configName: string;
  groupingFields: string[];
  availableFields: string[];
  detectedClaimTypes: DetectedClaimType[];
}

export function PortalComparisonSetup({
  portalId,
  configId,
  configName,
  groupingFields,
  availableFields,
  detectedClaimTypes,
}: PortalComparisonSetupProps) {
  const router = useRouter();

  const [showImport, setShowImport] = useState(false);
  const [importPortals, setImportPortals] = useState<Array<{ id: string; name: string }>>([]);
  const [importSourceId, setImportSourceId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoadingPortals, setImportLoadingPortals] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [templateRefreshKey, setTemplateRefreshKey] = useState(0);
  const [deleting, setDeleting] = useState(false);

  async function openImport() {
    setShowImport(true);
    setImportError(null);
    setImportSourceId("");
    setImportDone(false);
    setImportLoadingPortals(true);
    try {
      const res = await fetch("/api/portals");
      const data = await res.json();
      setImportPortals(
        Array.isArray(data) ? data.filter((p: { id: string }) => p.id !== portalId) : []
      );
    } catch {
      setImportError("Failed to load portals");
    } finally {
      setImportLoadingPortals(false);
    }
  }

  async function executeImport() {
    if (!importSourceId) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/comparison-setup/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePortalId: importSourceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to import");
      }
      setImportDone(true);
      setTemplateRefreshKey((k) => k + 1);
      setTimeout(() => {
        setShowImport(false);
        setImportDone(false);
        router.refresh();
      }, 1200);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import comparison setup");
    } finally {
      setImporting(false);
    }
  }

  async function deleteConfig() {
    if (!confirm(`Delete "${configName}" and all its templates?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/portals/${portalId}/configs/${configId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
      router.push(`/portals/${portalId}`);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <TooltipProvider>
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">Comparison Setup</CardTitle>
            <Tooltip
              side="right"
              content={
                <div className="space-y-1.5">
                  <p className="font-medium text-popover-foreground">What is Comparison Setup?</p>
                  <p>Defines <strong>which portal fields</strong> the AI checks against the uploaded document, and <strong>how strictly</strong> — fuzzy (ignore formatting), exact, or numeric (within a tolerance).</p>
                  <p>Rules are set per claim type so different claim types can have different comparison logic.</p>
                  <div className="pt-1.5 border-t border-border space-y-1">
                    <p className="font-medium text-popover-foreground">vs. Document Type (Intelligence)</p>
                    <p className="text-muted-foreground">Document Types validate the PDF itself — required fields present, no duplicates. Comparison Setup is about cross-checking: do the portal&apos;s values match what&apos;s written in the PDF?</p>
                  </div>
                </div>
              }
            >
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0 mt-0.5" />
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure how the AI compares scraped portal data against your uploaded documents.
          </p>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={
              showImport
                ? () => {
                    setShowImport(false);
                    setImportError(null);
                  }
                : openImport
            }
            className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {showImport ? "Cancel" : "Copy from portal"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={deleteConfig}
            disabled={deleting}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {showImport && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Copy comparison setup from another portal
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Copies the grouping field and all comparison rules. This will replace the current
                setup on this portal.
              </p>
            </div>
            {importLoadingPortals ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading portals…
              </div>
            ) : importPortals.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No other portals available to copy from.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={importSourceId}
                  onChange={(e) => {
                    setImportSourceId(e.target.value);
                    setImportError(null);
                  }}
                  className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select source portal…</option>
                  {importPortals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={executeImport}
                  disabled={!importSourceId || importing || importDone}
                  className="h-8 shrink-0 text-xs"
                >
                  {importDone ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Import"
                  )}
                </Button>
              </div>
            )}
            {importError && <p className="text-xs text-destructive">{importError}</p>}
          </div>
        )}

        <GroupingFieldConfig
          portalId={portalId}
          configId={configId}
          currentGroupingFields={groupingFields}
          availableFields={availableFields}
          detectedClaimTypes={detectedClaimTypes}
          onSaved={() => router.refresh()}
        />
        <div className="border-t border-border pt-5">
          <TemplateList
            portalId={portalId}
            configId={configId}
            groupingFields={groupingFields}
            detectedClaimTypes={detectedClaimTypes}
            availableFields={availableFields}
            refreshKey={templateRefreshKey}
          />
        </div>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
