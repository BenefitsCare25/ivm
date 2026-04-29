// ─── Scrape Filters ──────────────────────────────────────────────

export interface ScrapeFilters {
  excludeByStatus: string[];
  excludeBySubmittedBy: string[];
  excludeByClaimType: string[];
}

export const DEFAULT_SCRAPE_FILTERS: ScrapeFilters = {
  excludeByStatus: [],
  excludeBySubmittedBy: [],
  excludeByClaimType: [],
};

// ─── Enums (mirror Prisma enums for client use) ─────────────────

export const PORTAL_AUTH_METHODS = ["COOKIES", "CREDENTIALS"] as const;
export type PortalAuthMethod = (typeof PORTAL_AUTH_METHODS)[number];

export const SCRAPE_SESSION_STATUSES = [
  "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type ScrapeSessionStatus = (typeof SCRAPE_SESSION_STATUSES)[number];

export const TRACKED_ITEM_STATUSES = [
  "DISCOVERED", "PROCESSING", "COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED", "REQUIRE_DOC",
] as const;
export type TrackedItemStatus = (typeof TRACKED_ITEM_STATUSES)[number];

export const TERMINAL_ITEM_STATUSES = [
  "COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED",
] as const satisfies ReadonlyArray<TrackedItemStatus>;

export const COMPARISON_FIELD_STATUSES = [
  "MATCH", "MISMATCH", "MISSING_IN_PDF", "MISSING_ON_PAGE", "UNCERTAIN",
] as const;
export type ComparisonFieldStatus = (typeof COMPARISON_FIELD_STATUSES)[number];

// ─── FWA / Validation Alert Display ──────────────────────────────

export const FWA_RULE_TYPES = new Set([
  "TAMPERING", "DUPLICATE", "DOC_TYPE_MATCH",
  "BUSINESS_RULE", "REQUIRED_DOCUMENT", "CURRENCY_CONVERSION",
]);

export const FWA_PRIORITY: Record<string, number> = {
  TAMPERING: 3, DUPLICATE: 2, DOC_TYPE_MATCH: 1, BUSINESS_RULE: 1, REQUIRED_DOCUMENT: 1,
  CURRENCY_CONVERSION: 0,
};

export const FWA_LABELS: Record<string, string> = {
  TAMPERING: "Tampering",
  DUPLICATE: "Duplicate",
  DOC_TYPE_MATCH: "Wrong Doc Type",
  BUSINESS_RULE: "Rule Violation",
  REQUIRED_DOCUMENT: "Missing Document",
  CURRENCY_CONVERSION: "Foreign Currency",
};

export interface ValidationAlert {
  id: string;
  ruleType: string;
  status: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

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

// ─── Comparison Template ───────────────────────────────────────

export const MATCH_MODES = ["fuzzy", "exact", "numeric"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  fuzzy: "Fuzzy (names, dates, text)",
  exact: "Exact match",
  numeric: "Numeric (with tolerance)",
};

export interface TemplateField {
  portalFieldName: string;
  documentFieldName: string;
  mode: MatchMode;
  tolerance?: number;
}

// ─── Required Documents ────────────────────────────────────────

export const REQUIRED_DOCUMENT_RULES = ["required", "one_of"] as const;
export type RequiredDocumentRule = (typeof REQUIRED_DOCUMENT_RULES)[number];

export interface RequiredDocument {
  documentTypeName: string;
  rule: RequiredDocumentRule;
  group?: string;
}

// ─── Business Rules ────────────────────────────────────────────

export const BUSINESS_RULE_SEVERITIES = ["critical", "warning", "info"] as const;
export type BusinessRuleSeverity = (typeof BUSINESS_RULE_SEVERITIES)[number];

export const BUSINESS_RULE_SEVERITY_LABELS: Record<BusinessRuleSeverity, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
};

export const BUSINESS_RULE_CATEGORIES = [
  "Amount Validation",
  "Document Check",
  "Line Item Check",
  "Duplicate Detection",
  "Compliance Check",
] as const;

export interface BusinessRule {
  id: string;
  rule: string;
  category: string;
  severity: BusinessRuleSeverity;
}

// ─── AI Response Types (business rules + required docs) ────────

export interface BusinessRuleResult {
  rule: string;
  category: string;
  status: "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE";
  evidence: string;
  notes?: string;
}

export interface RequiredDocumentCheck {
  documentTypeName: string;
  found: boolean;
  notes?: string;
}

export interface DiagnosisAssessment {
  diagnosis: string;
  icdCode: string | null;
  source: "document" | "portal" | "inferred";
  confidence: number;
  evidence: string;
}

export interface ComparisonTemplateSummary {
  id: string;
  portalId: string;
  comparisonConfigId: string | null;
  providerGroupId: string | null;
  providerGroupName: string | null;
  name: string;
  groupingKey: Record<string, string>;
  fields: TemplateField[];
  requiredDocuments: RequiredDocument[];
  businessRules: BusinessRule[];
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonConfigSummary {
  id: string;
  portalId: string;
  name: string;
  groupingFields: string[];
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Provider Groups ──────────────────────────────────────────────

export const PROVIDER_GROUP_MATCH_MODES = ["list", "others"] as const;
export type ProviderGroupMatchMode = (typeof PROVIDER_GROUP_MATCH_MODES)[number];

export const PROVIDER_GROUP_MATCH_MODE_LABELS: Record<ProviderGroupMatchMode, string> = {
  list: "Match from list",
  others: "Match all others",
};

export interface ProviderGroupSummary {
  id: string;
  portalId: string;
  name: string;
  providerFieldName: string;
  matchMode: ProviderGroupMatchMode;
  members: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Field Discovery ──────────────────────────────────────────

export interface DiscoveredClaimType {
  groupingKey: Record<string, string>;
  detailFields: string[];
  sampleUrl: string;
  discoveredAt: string;
}

export interface DetectedClaimType {
  label: string;
  groupingKey: Record<string, string>;
}

// ─── Comparison Result ──────────────────────────────────────────

export interface DocumentLineMatch {
  /** Human-readable label of the matched line item (e.g. "Payable by MEDISAVE") */
  label: string;
  /** Value as it appears in the document (e.g. "167.70" or "-167.70") */
  value: string;
  /** Optional source file name when multiple documents are present */
  sourceFile?: string;
}

export interface FieldComparison {
  fieldName: string;
  pageValue: string | null;
  pdfValue: string | null;
  status: ComparisonFieldStatus;
  confidence: number;
  notes?: string;
  sourceFile?: string;
  /** When status=MISMATCH, optional list of document line items where the portal value was found */
  documentLineMatches?: DocumentLineMatch[];
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
  templateId: string | null;
  templateName: string | null;
}

// ─── Shared UI types (used by tracked-items-table + expanded-row) ──

export interface ItemFile {
  id: string;
  fileName: string;
  mimeType: string;
}

export interface ComparisonSummary {
  matchCount: number;
  mismatchCount: number;
  summary: string | null;
  fieldComparisons: FieldComparison[];
  diagnosisAssessment?: DiagnosisAssessment | null;
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
  REQUIRE_DOC: "Require Doc",
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
  "AI_EXTRACT_TRUNCATED",
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
  AI_EXTRACT_TRUNCATED: "Extraction Truncated",
  AI_COMPARE_START: "AI Comparing Fields",
  AI_COMPARE_DONE: "AI Comparison Done",
  AI_COMPARE_FAIL: "AI Comparison Failed",
  ITEM_COMPLETE: "Completed",
  ITEM_ERROR: "Error",
};

export const EVENT_SEVERITY: Record<ItemEventType, "info" | "success" | "error" | "warning"> = {
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
  AI_EXTRACT_TRUNCATED: "warning",
  AI_COMPARE_START: "info",
  AI_COMPARE_DONE: "success",
  AI_COMPARE_FAIL: "error",
  ITEM_COMPLETE: "success",
  ITEM_ERROR: "error",
};
