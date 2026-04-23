"use client";

import { useState, Fragment } from "react";
import {
  FileText,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { ItemStatusBadge } from "./portal-status-badge";
import { ExpandedPanel } from "./expanded-row";
import type { TrackedItemStatus, FieldComparison, ItemFile, ComparisonSummary, ValidationAlert } from "@/types/portal";
import { FWA_LABELS } from "@/types/portal";

interface FwaAlert {
  ruleType: string;
  status: string;
  message: string;
}

export interface TableItem {
  id: string;
  portalItemId: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  errorMessage: string | null;
  files: ItemFile[];
  comparisonResult: ComparisonSummary | null;
  fwaAlert: FwaAlert | null;
  fwaAlerts: ValidationAlert[];
  createdAt: string;
  updatedAt: string;
  runtime?: string | null;
}

interface TrackedItemsTableProps {
  items: TableItem[];
  portalId: string;
  sessionId: string;
}

export function TrackedItemsTable({ items, portalId, sessionId }: TrackedItemsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
        No items found in this session.
      </div>
    );
  }

  const idKey = Object.keys(items[0].listData).find(
    (k) => items[0].listData[k] === items[0].portalItemId
  );
  const allListKeys = Object.keys(items[0].listData).filter((k) => k !== idKey);
  const subKeySet = new Set(allListKeys.filter((k) => k.startsWith("Sub ")));
  const previewKeys = allListKeys
    .filter((k) => !subKeySet.has(k))
    .slice(0, 3);
  const columnCount = previewKeys.length + 6;

  return (
    <TooltipProvider>
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
            <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
              FWA
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
              Runtime
            </th>
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
                    isExpanded ? "bg-muted/40" : "hover:bg-muted/30"
                  }`}
                  onClick={toggle}
                >
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                    {item.portalItemId || item.id.slice(0, 8)}
                  </td>

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

                  <td className="whitespace-nowrap px-3 py-2.5">
                    {item.fwaAlert ? (
                      <Tooltip content={item.fwaAlert.message} side="right">
                        <span
                          className={`inline-flex cursor-default items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            item.fwaAlert.status === "FAIL"
                              ? "bg-status-error/10 text-status-error"
                              : "bg-amber-500/10 text-amber-500"
                          }`}
                        >
                          <ShieldAlert className="h-3 w-3 shrink-0" />
                          {FWA_LABELS[item.fwaAlert.ruleType] ?? item.fwaAlert.ruleType}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">&mdash;</span>
                    )}
                  </td>

                  {previewKeys.map((key) => {
                    const subKey = 'Sub ' + key;
                    const subVal = item.listData[subKey];
                    return (
                      <td
                        key={key}
                        className="max-w-[200px] px-3 py-2.5 text-muted-foreground text-xs"
                      >
                        <div className="truncate">{item.listData[key] ?? "—"}</div>
                        {subVal && (
                          <div className="truncate text-muted-foreground/60 mt-0.5">
                            {subVal}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {item.runtime ?? <span className="text-muted-foreground/40">&mdash;</span>}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-3 py-2.5">
                    {item.files.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        {item.files.length}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">&mdash;</span>
                    )}
                  </td>
                </tr>

                {isExpanded && (
                  <ExpandedPanel
                    item={{
                      id: item.id,
                      status: item.status,
                      listData: item.listData,
                      detailData: item.detailData,
                      detailUrl: item.detailUrl,
                      errorMessage: item.errorMessage,
                      files: item.files,
                      comparisonResult: item.comparisonResult,
                      fwaAlerts: item.fwaAlerts,
                    }}
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
    </TooltipProvider>
  );
}
