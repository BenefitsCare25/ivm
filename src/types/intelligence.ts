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

