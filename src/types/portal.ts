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

// ─── Auth Status ────────────────────────────────────────────────

export type AuthStatus = "ok" | "warn" | "expired" | "session_expired" | "missing";

// ─── Enums (mirror Prisma enums for client use) ─────────────────

export const PORTAL_AUTH_METHODS = ["COOKIES", "CREDENTIALS"] as const;
export type PortalAuthMethod = (typeof PORTAL_AUTH_METHODS)[number];

export const SCRAPE_SESSION_STATUSES = [
  "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type ScrapeSessionStatus = (typeof SCRAPE_SESSION_STATUSES)[number];

export const TRACKED_ITEM_STATUSES = [
  "DISCOVERED", "PROCESSING", "COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED", "REQUIRE_DOC", "FILTERED",
] as const;
export type TrackedItemStatus = (typeof TRACKED_ITEM_STATUSES)[number];

export const TERMINAL_ITEM_STATUSES = [
  "COMPARED", "FLAGGED", "VERIFIED", "ERROR", "SKIPPED", "FILTERED",
] as const satisfies ReadonlyArray<TrackedItemStatus>;

export const COMPARISON_FIELD_STATUSES = [
  "MATCH", "MISMATCH", "MISSING_IN_PDF", "MISSING_ON_PAGE", "UNCERTAIN",
] as const;
export type ComparisonFieldStatus = (typeof COMPARISON_FIELD_STATUSES)[number];

// ─── FWA / Validation Alert Display ──────────────────────────────

export const FWA_RULE_TYPES = new Set([
  "TAMPERING", "DOC_TYPE_MATCH", "UNREADABLE_DOCUMENT",
  "BUSINESS_RULE", "REQUIRED_DOCUMENT", "CURRENCY_CONVERSION", "BILL_STATUS",
  "CLAIMANT_MATCH", "WRONG_CLAIM_TYPE",
]);

export const FWA_PRIORITY: Record<string, number> = {
  TAMPERING: 3, UNREADABLE_DOCUMENT: 2, WRONG_CLAIM_TYPE: 2, CLAIMANT_MATCH: 2,
  DOC_TYPE_MATCH: 1, BUSINESS_RULE: 1, REQUIRED_DOCUMENT: 1,
  CURRENCY_CONVERSION: 0, BILL_STATUS: 0,
};

export const FWA_LABELS: Record<string, string> = {
  TAMPERING: "Tampering",
  DOC_TYPE_MATCH: "Wrong Doc Type",
  UNREADABLE_DOCUMENT: "Unreadable Document",
  BUSINESS_RULE: "Rule Violation",
  REQUIRED_DOCUMENT: "Missing Document",
  CURRENCY_CONVERSION: "Foreign Currency",
  BILL_STATUS: "Bill Status",
  CLAIMANT_MATCH: "Pending Document",
  WRONG_CLAIM_TYPE: "Wrong Claim Type",
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
  totalProcessed: number;
  totalFound: number;
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

// Identifiers, dates, and codes must NOT default to numeric — e.g. an invoice
// number or a "Due Date" should stay exact/fuzzy, not be parsed as a number.
const NON_NUMERIC_FIELD_RE = /\b(no\.?|num(ber)?|id|code|ref(erence)?|date|type|name|status|description|remarks?|address|gender|nric|passport)\b/;
// Monetary amount words, matched on word boundaries so "sum"≠"summary", "tax"≠… etc.
const AMOUNT_FIELD_RE = /\b(amount|total|subtotal|balance|payable|receipt|fee|charge|price|cost|gst|paid|co-?pay|deductible|premium|settlement|reimburs\w*|outstanding)\b/;

/**
 * Suggest a default match mode + tolerance from a field name. Monetary-looking
 * fields default to numeric (0.01 cent tolerance) so formatting differences
 * ("$169.60" vs "169.6") never produce false mismatches. Identifier/date fields
 * are explicitly excluded so they keep fuzzy/exact semantics.
 */
export function inferDefaultMode(fieldName: string): { mode: MatchMode; tolerance?: number } {
  const lower = fieldName.toLowerCase();
  if (NON_NUMERIC_FIELD_RE.test(lower)) return { mode: "fuzzy" };
  if (AMOUNT_FIELD_RE.test(lower)) return { mode: "numeric", tolerance: 0.01 };
  return { mode: "fuzzy" };
}

export interface TemplateField {
  portalFieldName: string;
  documentFieldName: string;
  mode: MatchMode;
  tolerance?: number;
  /** Re-verify a MISMATCH on this field against the source document with vision. */
  verifyWithVision?: boolean;
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

// Rule evaluation engine: "ai" = natural-language judged by the model,
// "code" = deterministic field/operator/value check evaluated in code.
export const BUSINESS_RULE_TYPES = ["ai", "code"] as const;
export type BusinessRuleType = (typeof BUSINESS_RULE_TYPES)[number];

export const CODE_RULE_OPERATORS = [
  "eq", "ne", "gt", "gte", "lt", "lte", "is_empty", "not_empty",
] as const;
export type CodeRuleOperator = (typeof CODE_RULE_OPERATORS)[number];

export const CODE_RULE_OPERATOR_LABELS: Record<CodeRuleOperator, string> = {
  eq: "= equals",
  ne: "≠ not equal",
  gt: "> greater than",
  gte: "≥ greater or equal",
  lt: "< less than",
  lte: "≤ less or equal",
  is_empty: "is empty",
  not_empty: "is not empty",
};

/** Operators that compare against a value/field; the rest are unary. */
export const CODE_RULE_BINARY_OPERATORS: CodeRuleOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

export interface BusinessRule {
  id: string;
  rule: string;
  category: string;
  severity: BusinessRuleSeverity;
  /** Defaults to "ai" when omitted (back-compat with existing templates). */
  type?: BusinessRuleType;
  /** Re-verify a flagged result against the source document with a vision model. */
  verifyWithVision?: boolean;
  // ── Code-rule fields (only when type === "code") ──
  /** Field name to evaluate (matched against portal + document fields). */
  field?: string;
  operator?: CodeRuleOperator;
  /** Literal value to compare against (for binary operators). */
  value?: string;
  /** Alternative to `value` — compare against another field's value. */
  compareField?: string;
}

// ─── Vision Verification (selective re-check) ──────────────────

export const VISION_VERDICTS = ["CONFIRMED", "REFUTED", "UNCERTAIN"] as const;
export type VisionVerdict = (typeof VISION_VERDICTS)[number];

export interface VisionVerification {
  verdict: VisionVerdict;
  explanation: string;
  /** File the verification was run against. */
  sourceFile?: string;
  model?: string;
}

// ─── AI Response Types (business rules + required docs) ────────

export interface BusinessRuleResult {
  rule: string;
  category: string;
  status: "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE";
  evidence: string;
  notes?: string;
  /** Set for deterministic code-rule results so they pair to their source rule precisely. */
  ruleId?: string;
  /** Set when the result was re-checked against the source document with vision. */
  visionVerification?: VisionVerification;
}

export interface RequiredDocumentCheck {
  documentTypeName: string;
  found: boolean;
  notes?: string;
  /** Deterministic confidence (0-1) in the found / not-found decision. */
  confidence?: number;
  /**
   * Presence could not be confirmed with confidence — surface as a
   * "manual review recommended" WARNING instead of a hard "missing" FAIL.
   */
  uncertain?: boolean;
  /** How the document was resolved against the submitted set. */
  matchedVia?: "canonical" | "alias" | "synonym" | "keyword" | "llm" | "none";
  /** Detected billing-document status, when the requirement is a hospital bill. */
  billStatus?: BillStatus;
  /** File the document was matched to (when found deterministically). */
  matchedFile?: string;
}

// ─── Bill Status (interim vs final hospital billing) ───────────
export const BILL_STATUSES = ["interim", "final", "unknown"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export interface BillStatusSignal {
  status: BillStatus;
  /** File the signal was detected in. */
  fileName: string;
  /** Phrase that triggered the classification (for evidence). */
  evidence: string;
  /** Auto-extracted outstanding balance, when present. */
  outstandingBalance?: { label: string; value: string };
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
  /** Set when a MISMATCH was re-checked against the source document with vision. */
  visionVerification?: VisionVerification;
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
  FILTERED: "Filtered",
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
