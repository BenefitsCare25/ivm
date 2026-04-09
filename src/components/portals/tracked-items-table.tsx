"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import {
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemStatusBadge } from "./portal-status-badge";
import type { TrackedItemStatus, FieldComparison } from "@/types/portal";

interface ItemFile {
  id: string;
  fileName: string;
  mimeType: string;
}

interface ComparisonSummary {
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  fieldComparisons: FieldComparison[];
}

interface TableItem {
  id: string;
  portalItemId: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  errorMessage: string | null;
  files: ItemFile[];
  comparisonResult: ComparisonSummary | null;
  createdAt: string;
  updatedAt: string;
}

interface TrackedItemsTableProps {
  items: TableItem[];
  portalId: string;
  sessionId: string;
}

function fileUrl(portalId: string, sessionId: string, itemId: string, fileId: string) {
  return `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/files/${fileId}`;
}

// ── Comparison panel ────────────────────────────────────────────────────────

function ComparisonPanel({ result }: { result: ComparisonSummary }) {
  const mismatches = result.fieldComparisons.filter(
    (f) => f.status !== "MATCH"
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {result.matchCount} matched
        </span>
        {result.mismatchCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
            <XCircle className="h-3.5 w-3.5" />
            {result.mismatchCount} mismatched
          </span>
        )}
      </div>

      {mismatches.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 divide-y divide-amber-100">
          {mismatches.slice(0, 5).map((f) => (
            <div key={f.fieldName} className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs">
              <span className="font-medium text-foreground truncate">{f.fieldName}</span>
              <span className="text-muted-foreground truncate" title={f.pageValue ?? ""}>
                Portal: {f.pageValue || "—"}
              </span>
              <span className="text-amber-700 truncate" title={f.pdfValue ?? ""}>
                Doc: {f.pdfValue || "—"}
              </span>
            </div>
          ))}
          {mismatches.length > 5 && (
            <div className="px-3 py-1 text-xs text-muted-foreground">
              +{mismatches.length - 5} more mismatches
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expanded detail panel ────────────────────────────────────────────────────

function ExpandedPanel({
  item,
  portalId,
  sessionId,
  columnCount,
}: {
  item: TableItem;
  portalId: string;
  sessionId: string;
  columnCount: number;
}) {
  const listEntries = Object.entries(item.listData);
  const detailEntries = item.detailData ? Object.entries(item.detailData) : [];

  return (
    <tr>
      <td colSpan={columnCount} className="p-0">
        <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-4">

          {/* Error message */}
          {item.errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-error mt-0.5" />
              <p className="text-xs text-status-error">{item.errorMessage}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* List data */}
            {listEntries.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Portal Record
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {listEntries.map(([k, v]) => (
                    <Fragment key={k}>
                      <span className="text-xs text-muted-foreground truncate">{k}</span>
                      <span className="text-xs text-foreground truncate" title={v}>{v || "—"}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Detail data */}
            {detailEntries.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Detail Page
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {detailEntries.map(([k, v]) => (
                    <Fragment key={k}>
                      <span className="text-xs text-muted-foreground truncate">{k}</span>
                      <span className="text-xs text-foreground truncate" title={v}>{v || "—"}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Files */}
          {item.files.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Documents
              </p>
              <div className="flex flex-wrap gap-2">
                {item.files.map((f) => (
                  <a
                    key={f.id}
                    href={fileUrl(portalId, sessionId, item.id, f.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="max-w-[200px] truncate">{f.fileName}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Comparison */}
          {item.comparisonResult && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comparison
              </p>
              <ComparisonPanel result={item.comparisonResult} />
              {item.comparisonResult.summary && (
                <p className="mt-1.5 text-xs text-muted-foreground italic">
                  {item.comparisonResult.summary}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {item.detailUrl && (
              <a
                href={item.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Portal
              </a>
            )}
            <Button variant="outline" size="sm" asChild className="ml-auto">
              <Link href={`/portals/${portalId}/sessions/${sessionId}/items/${item.id}`}>
                Full Detail
              </Link>
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main table ───────────────────────────────────────────────────────────────

export function TrackedItemsTable({ items, portalId, sessionId }: TrackedItemsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
        No items found in this session.
      </div>
    );
  }

  // Show up to 3 list-data columns in the main row; rest visible in expanded panel
  const previewKeys = items.length > 0 ? Object.keys(items[0].listData).slice(0, 3) : [];
  // Total visible columns: ID + Status + previewKeys + Files + Toggle = previewKeys.length + 4
  const columnCount = previewKeys.length + 4;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted">
            <th className="w-8 px-3 py-2.5" />
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
              ID
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
              Status
            </th>
            {previewKeys.map((key) => (
              <th
                key={key}
                className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                {key}
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
              Docs
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const toggle = () => setExpandedId(isExpanded ? null : item.id);

            return (
              <Fragment key={item.id}>
                <tr
                  className={`border-t border-border cursor-pointer select-none transition-colors ${
                    isExpanded
                      ? "bg-muted/40"
                      : "hover:bg-muted/30"
                  }`}
                  onClick={toggle}
                >
                  {/* Expand toggle */}
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </td>

                  {/* ID */}
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                    {item.portalItemId || item.id.slice(0, 8)}
                  </td>

                  {/* Status */}
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {item.status === "PROCESSING" && (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      )}
                      {item.status === "ERROR" && (
                        <AlertCircle className="h-3 w-3 text-status-error" />
                      )}
                      <ItemStatusBadge status={item.status} />
                    </div>
                  </td>

                  {/* Preview columns */}
                  {previewKeys.map((key) => (
                    <td
                      key={key}
                      className="max-w-[180px] truncate px-3 py-2.5 text-muted-foreground text-xs"
                    >
                      {item.listData[key] ?? "—"}
                    </td>
                  ))}

                  {/* Files badge */}
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {item.files.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        {item.files.length}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>
                </tr>

                {/* Expanded panel */}
                {isExpanded && (
                  <ExpandedPanel
                    item={item}
                    portalId={portalId}
                    sessionId={sessionId}
                    columnCount={columnCount}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
