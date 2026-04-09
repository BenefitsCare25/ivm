// ─── Enums (mirror Prisma enums for client use) ─────────────────

export const PORTAL_AUTH_METHODS = ["COOKIES", "CREDENTIALS"] as const;
export type PortalAuthMethod = (typeof PORTAL_AUTH_METHODS)[number];

export const SCRAPE_SESSION_STATUSES = [
  "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type ScrapeSessionStatus = (typeof SCRAPE_SESSION_STATUSES)[number];

export const TRACKED_ITEM_STATUSES = [
  "DISCOVERED", "PROCESSING", "COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED",
] as const;
export type TrackedItemStatus = (typeof TRACKED_ITEM_STATUSES)[number];

export const COMPARISON_FIELD_STATUSES = [
  "MATCH", "MISMATCH", "MISSING_IN_PDF", "MISSING_ON_PAGE", "UNCERTAIN",
] as const;
export type ComparisonFieldStatus = (typeof COMPARISON_FIELD_STATUSES)[number];

// ─── Selector Configurations (stored as JSON on Portal) ─────────

export interface ColumnSelector {
  name: string;
  selector: string;
}

export interface ListSelectors {
  tableSelector?: string;
  rowSelector?: string;
  columns?: ColumnSelector[];
  detailLinkSelector?: string;
  paginationSelector?: string;
}

export interface DetailSelectors {
  fieldSelectors?: Record<string, string>;
  downloadLinkSelector?: string;
  fileNameSelector?: string;
}

// ─── Portal Summary (for list views) ────────────────────────────

export interface PortalSummary {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: PortalAuthMethod;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  lastScrapeStatus: ScrapeSessionStatus | null;
  lastScrapeAt: string | null;
  totalItems: number;
  createdAt: string;
}

// ─── Portal Detail ──────────────────────────────────────────────

export interface PortalDetail {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: PortalAuthMethod;
  listPageUrl: string | null;
  listSelectors: ListSelectors;
  detailSelectors: DetailSelectors;
  scheduleEnabled: boolean;
  scheduleCron: string | null;
  hasCredentials: boolean;
  hasCookies: boolean;
  cookieExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Scrape Session ─────────────────────────────────────────────

export interface ScrapeSessionSummary {
  id: string;
  portalId: string;
  status: ScrapeSessionStatus;
  triggeredBy: string;
  itemsFound: number;
  itemsProcessed: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ─── Tracked Item ───────────────────────────────────────────────

export interface TrackedItemSummary {
  id: string;
  portalItemId: string;
  status: TrackedItemStatus;
  listData: Record<string, string>;
  detailPageUrl: string | null;
  matchCount: number | null;
  mismatchCount: number | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedItemDetail extends TrackedItemSummary {
  detailData: Record<string, string> | null;
  files: TrackedItemFileSummary[];
  comparisonResult: ComparisonResultSummary | null;
  errorMessage: string | null;
}

// ─── Tracked Item File ──────────────────────────────────────────

export interface TrackedItemFileSummary {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadedAt: string;
}

// ─── Comparison Result ──────────────────────────────────────────

export interface FieldComparison {
  fieldName: string;
  pageValue: string | null;
  pdfValue: string | null;
  status: ComparisonFieldStatus;
  confidence: number;
  notes?: string;
}

export interface ComparisonResultSummary {
  id: string;
  provider: string;
  fieldComparisons: FieldComparison[];
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// ─── Status helpers ─────────────────────────────────────────────

export const SCRAPE_STATUS_LABELS: Record<ScrapeSessionStatus, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const TRACKED_ITEM_STATUS_LABELS: Record<TrackedItemStatus, string> = {
  DISCOVERED: "Discovered",
  PROCESSING: "Processing",
  COMPARED: "Compared",
  FLAGGED: "Flagged",
  VERIFIED: "Verified",
  ERROR: "Error",
  SKIPPED: "Skipped",
};

export const COMPARISON_STATUS_LABELS: Record<ComparisonFieldStatus, string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  MISSING_IN_PDF: "Missing in PDF",
  MISSING_ON_PAGE: "Missing on Page",
  UNCERTAIN: "Uncertain",
};

// ─── Item Events (observability timeline) ───────────────────────

export const ITEM_EVENT_TYPES = [
  "AUTH_START",
  "AUTH_SUCCESS",
  "AUTH_FAIL",
  "PAGE_LOAD",
  "PAGE_LOAD_FAIL",
  "SELECTOR_MATCH",
  "SELECTOR_FAIL",
  "DETAIL_SCRAPE_START",
  "DETAIL_SCRAPE_DONE",
  "DETAIL_SCRAPE_FAIL",
  "DOWNLOAD_START",
  "DOWNLOAD_DONE",
  "DOWNLOAD_FAIL",
  "AI_EXTRACT_START",
  "AI_EXTRACT_DONE",
  "AI_EXTRACT_FAIL",
  "AI_COMPARE_START",
  "AI_COMPARE_DONE",
  "AI_COMPARE_FAIL",
  "ITEM_COMPLETE",
  "ITEM_ERROR",
] as const;
export type ItemEventType = (typeof ITEM_EVENT_TYPES)[number];

export interface ItemEventSummary {
  id: string;
  eventType: ItemEventType;
  payload: Record<string, unknown>;
  screenshotPath: string | null;
  durationMs: number | null;
  createdAt: string;
}

export const EVENT_TYPE_LABELS: Record<ItemEventType, string> = {
  AUTH_START: "Authenticating",
  AUTH_SUCCESS: "Authenticated",
  AUTH_FAIL: "Auth Failed",
  PAGE_LOAD: "Page Loaded",
  PAGE_LOAD_FAIL: "Page Load Failed",
  SELECTOR_MATCH: "Selectors Matched",
  SELECTOR_FAIL: "Selector Failed",
  DETAIL_SCRAPE_START: "Scraping Detail Page",
  DETAIL_SCRAPE_DONE: "Detail Page Scraped",
  DETAIL_SCRAPE_FAIL: "Detail Scrape Failed",
  DOWNLOAD_START: "Downloading Files",
  DOWNLOAD_DONE: "Files Downloaded",
  DOWNLOAD_FAIL: "Download Failed",
  AI_EXTRACT_START: "AI Extracting",
  AI_EXTRACT_DONE: "AI Extraction Done",
  AI_EXTRACT_FAIL: "AI Extraction Failed",
  AI_COMPARE_START: "AI Comparing Fields",
  AI_COMPARE_DONE: "AI Comparison Done",
  AI_COMPARE_FAIL: "AI Comparison Failed",
  ITEM_COMPLETE: "Completed",
  ITEM_ERROR: "Error",
};

export const EVENT_SEVERITY: Record<ItemEventType, "info" | "success" | "error"> = {
  AUTH_START: "info",
  AUTH_SUCCESS: "success",
  AUTH_FAIL: "error",
  PAGE_LOAD: "success",
  PAGE_LOAD_FAIL: "error",
  SELECTOR_MATCH: "success",
  SELECTOR_FAIL: "error",
  DETAIL_SCRAPE_START: "info",
  DETAIL_SCRAPE_DONE: "success",
  DETAIL_SCRAPE_FAIL: "error",
  DOWNLOAD_START: "info",
  DOWNLOAD_DONE: "success",
  DOWNLOAD_FAIL: "error",
  AI_EXTRACT_START: "info",
  AI_EXTRACT_DONE: "success",
  AI_EXTRACT_FAIL: "error",
  AI_COMPARE_START: "info",
  AI_COMPARE_DONE: "success",
  AI_COMPARE_FAIL: "error",
  ITEM_COMPLETE: "success",
  ITEM_ERROR: "error",
};
