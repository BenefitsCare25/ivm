import { Badge } from "@/components/ui/badge";
import {
  SCRAPE_STATUS_LABELS,
  TRACKED_ITEM_STATUS_LABELS,
  COMPARISON_STATUS_LABELS,
  type ScrapeSessionStatus,
  type TrackedItemStatus,
  type ComparisonFieldStatus,
} from "@/types/portal";

const SCRAPE_VARIANTS: Record<ScrapeSessionStatus, "success" | "warning" | "error" | "info" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "info",
  PENDING: "secondary",
  FAILED: "error",
  CANCELLED: "warning",
};

const ITEM_VARIANTS: Record<TrackedItemStatus, "success" | "warning" | "error" | "info" | "secondary"> = {
  DISCOVERED: "secondary",
  PROCESSING: "info",
  COMPARED: "success",
  FLAGGED: "warning",
  VERIFIED: "success",
  ERROR: "error",
  SKIPPED: "secondary",
  REQUIRE_DOC: "warning",
};

const COMPARISON_VARIANTS: Record<ComparisonFieldStatus, "success" | "warning" | "error" | "info" | "secondary"> = {
  MATCH: "success",
  MISMATCH: "error",
  MISSING_IN_PDF: "warning",
  MISSING_ON_PAGE: "warning",
  UNCERTAIN: "info",
};

export function ScrapeStatusBadge({ status }: { status: ScrapeSessionStatus }) {
  return <Badge variant={SCRAPE_VARIANTS[status]}>{SCRAPE_STATUS_LABELS[status]}</Badge>;
}

export function ItemStatusBadge({ status }: { status: TrackedItemStatus }) {
  return <Badge variant={ITEM_VARIANTS[status]}>{TRACKED_ITEM_STATUS_LABELS[status]}</Badge>;
}

export function ComparisonStatusBadge({ status }: { status: ComparisonFieldStatus }) {
  return <Badge variant={COMPARISON_VARIANTS[status]}>{COMPARISON_STATUS_LABELS[status]}</Badge>;
}

export const ITEM_STATUS_COLORS: Record<string, string> = {
  COMPARED:     "bg-status-success/15 text-status-success",
  FLAGGED:      "bg-status-warning/15 text-status-warning",
  ERROR:        "bg-status-error/15 text-status-error",
  PROCESSING:   "bg-blue-500/15 text-blue-500",
  DISCOVERED:   "bg-muted text-muted-foreground",
  SKIPPED:      "bg-muted/60 text-muted-foreground/60",
  REQUIRE_DOC:  "bg-status-warning/15 text-status-warning",
};
