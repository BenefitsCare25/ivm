// ─── Document Types ──────────────────────────────────────────────

export interface DocumentTypeData {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  requiredFields: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Validation ──────────────────────────────────────────────────

export const VALIDATION_STATUSES = ["PASS", "FAIL", "WARNING"] as const;
export type ValidationStatusType = (typeof VALIDATION_STATUSES)[number];

export const VALIDATION_RULE_TYPES = [
  "DOC_TYPE_MATCH",
  "MISSING_DOC",
  "DUPLICATE",
  "REQUIRED_FIELD",
  "BUSINESS_RULE",
] as const;
export type ValidationRuleType = (typeof VALIDATION_RULE_TYPES)[number];

export interface ValidationResultData {
  id: string;
  ruleType: string;
  status: ValidationStatusType;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Reference Datasets ──────────────────────────────────────────

export interface ReferenceDatasetData {
  id: string;
  name: string;
  description: string | null;
  columns: string[];
  rowCount: number;
  sourceType: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceEntryData {
  id: string;
  data: Record<string, string>;
  createdAt: string;
}

export interface CodeMappingRuleData {
  id: string;
  name: string;
  sourceFieldLabel: string;
  datasetId: string;
  lookupColumn: string;
  outputColumn: string;
  matchStrategy: string;
  isActive: boolean;
  dataset?: { id: string; name: string };
}

// ─── Business Rules ──────────────────────────────────────────────

export const TRIGGER_POINTS = ["POST_EXTRACTION", "POST_COMPARISON", "POST_MAPPING"] as const;
export type TriggerPoint = (typeof TRIGGER_POINTS)[number];

export const TRIGGER_POINT_LABELS: Record<TriggerPoint, string> = {
  POST_EXTRACTION: "After Extraction",
  POST_COMPARISON: "After Comparison",
  POST_MAPPING: "After Mapping",
};

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_empty",
  "is_not_empty",
  "matches_regex",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  between: "between",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  matches_regex: "matches regex",
};

export interface RuleCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number;
  value2?: number;
}

export interface RuleConditions {
  logic: "AND" | "OR";
  conditions: RuleCondition[];
}

export const ACTION_TYPES = ["FLAG", "SET_STATUS", "ADD_NOTE", "SET_FIELD", "ESCALATE", "SKIP"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  FLAG: "Flag item",
  SET_STATUS: "Set status",
  ADD_NOTE: "Add note",
  SET_FIELD: "Set field value",
  ESCALATE: "Escalate",
  SKIP: "Skip processing",
};

export interface RuleAction {
  type: ActionType;
  params: Record<string, string>;
}

export interface BusinessRuleData {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  triggerPoint: TriggerPoint;
  conditions: RuleConditions;
  actions: RuleAction[];
  scope: { documentTypes?: string[]; portalIds?: string[] };
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

// ─── Extraction Templates ────────────────────────────────────────

export interface ExpectedField {
  label: string;
  fieldType: string;
  required: boolean;
  aliases: string[];
}

export interface ExtractionTemplateData {
  id: string;
  name: string;
  documentTypeId: string | null;
  expectedFields: ExpectedField[];
  instructions: string | null;
  isActive: boolean;
  documentType?: { id: string; name: string } | null;
}

// ─── Match Strategies ────────────────────────────────────────────

export const MATCH_STRATEGIES = ["exact", "fuzzy", "contains", "ai"] as const;
export type MatchStrategy = (typeof MATCH_STRATEGIES)[number];

export const MATCH_STRATEGY_LABELS: Record<MatchStrategy, string> = {
  exact: "Exact match",
  fuzzy: "Fuzzy match",
  contains: "Contains",
  ai: "AI semantic match",
};
