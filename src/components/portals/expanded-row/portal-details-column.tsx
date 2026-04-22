"use client";

import { ExternalLink, CheckCircle2, XCircle, HelpCircle, Minus } from "lucide-react";
import type { FieldComparison, ComparisonFieldStatus } from "@/types/portal";

interface PortalDetailsColumnProps {
  detailData: Record<string, string> | null;
  listData: Record<string, string>;
  fieldComparisons: FieldComparison[];
  detailUrl: string | null;
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildComparisonMap(comparisons: FieldComparison[]): Map<string, FieldComparison> {
  const map = new Map<string, FieldComparison>();
  for (const c of comparisons) {
    map.set(normalizeFieldName(c.fieldName), c);
  }
  return map;
}

const STATUS_ICONS: Record<ComparisonFieldStatus, { icon: typeof CheckCircle2; cls: string }> = {
  MATCH: { icon: CheckCircle2, cls: "text-status-success" },
  MISMATCH: { icon: XCircle, cls: "text-status-error" },
  UNCERTAIN: { icon: HelpCircle, cls: "text-amber-500" },
  MISSING_IN_PDF: { icon: Minus, cls: "text-muted-foreground" },
  MISSING_ON_PAGE: { icon: Minus, cls: "text-muted-foreground" },
};

function FieldMatchIndicator({ status }: { status: ComparisonFieldStatus }) {
  const { icon: Icon, cls } = STATUS_ICONS[status];
  return <Icon className={`h-3 w-3 shrink-0 ${cls}`} />;
}

export function PortalDetailsColumn({
  detailData,
  listData,
  fieldComparisons,
  detailUrl,
}: PortalDetailsColumnProps) {
  const data = detailData && Object.keys(detailData).length > 0 ? detailData : null;
  const entries = Object.entries(data ?? listData);
  const compMap = data ? buildComparisonMap(fieldComparisons) : null;

  return (
    <div className="space-y-3 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {data ? "Portal Details" : "List Page Data"}
        </p>
        {detailUrl && (
          <a
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Portal
          </a>
        )}
      </div>

      {!data && (
        <p className="text-xs text-muted-foreground/60 italic">
          Detail page not scraped &mdash; showing list data
        </p>
      )}

      <div className="space-y-0.5">
        {entries.map(([key, value]) => {
          const comparison = compMap?.get(normalizeFieldName(key));
          return (
            <div key={key} className="flex items-center gap-2 py-1 min-w-0">
              <span className="text-xs text-muted-foreground shrink-0 w-[120px] truncate" title={key}>
                {key}
              </span>
              <span className="text-xs text-foreground min-w-0 flex-1 break-words" title={value}>
                {value || "\u2014"}
              </span>
              {comparison && <FieldMatchIndicator status={comparison.status} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
