"use client";

import { AlertCircle, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { PortalDetailsColumn } from "./portal-details-column";
import { ComparisonColumn } from "./comparison-column";
import { DocumentViewerColumn } from "./document-viewer-column";
import type { TrackedItemStatus, ItemFile, ComparisonSummary, ValidationAlert } from "@/types/portal";

interface ExpandedPanelItem {
  id: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailData: Record<string, string> | null;
  detailUrl: string | null;
  errorMessage: string | null;
  files: ItemFile[];
  comparisonResult: ComparisonSummary | null;
  fwaAlerts: ValidationAlert[];
}

interface ExpandedPanelProps {
  item: ExpandedPanelItem;
  portalId: string;
  sessionId: string;
  columnCount: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; label: string; cls: string }> = {
  COMPARED:  { icon: CheckCircle2, label: "Processed",    cls: "text-status-success" },
  FLAGGED:   { icon: CheckCircle2, label: "Processed",    cls: "text-status-success" },
  VERIFIED:  { icon: CheckCircle2, label: "Verified",     cls: "text-status-success" },
  ERROR:     { icon: XCircle,      label: "Failed",       cls: "text-status-error" },
  PROCESSING:{ icon: Loader2,      label: "Processing...",cls: "text-blue-500" },
  DISCOVERED:{ icon: Clock,        label: "Pending",      cls: "text-muted-foreground" },
  SKIPPED:   { icon: Clock,        label: "Skipped",      cls: "text-muted-foreground" },
};

export function ExpandedPanel({ item, portalId, sessionId, columnCount }: ExpandedPanelProps) {
  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.DISCOVERED;
  const StatusIcon = cfg.icon;

  return (
    <tr>
      <td colSpan={columnCount} className="p-0">
        <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-4">

          <div className="flex items-start gap-2">
            <StatusIcon
              className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cfg.cls} ${
                item.status === "PROCESSING" ? "animate-spin" : ""
              }`}
            />
            <span className={`text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
            {item.status === "ERROR" && item.errorMessage && (
              <span className="text-xs text-status-error/80 ml-2">
                &mdash; {item.errorMessage}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1.5fr_1.2fr] overflow-hidden">
            <PortalDetailsColumn
              detailData={item.detailData}
              listData={item.listData}
              fieldComparisons={item.comparisonResult?.fieldComparisons ?? []}
              detailUrl={item.detailUrl}
            />
            <ComparisonColumn
              comparisonResult={item.comparisonResult}
              fwaAlerts={item.fwaAlerts}
            />
            <div className="md:col-span-2 lg:col-span-1">
              <DocumentViewerColumn
                files={item.files}
                portalId={portalId}
                sessionId={sessionId}
                itemId={item.id}
              />
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
