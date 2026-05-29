import { resolveRuleOutcome } from "./flagging";
import type { BusinessRule, BusinessRuleResult } from "@/types/portal";

export interface BuiltValidation {
  ruleType: "BUSINESS_RULE";
  status: "FAIL" | "WARNING";
  message: string;
  metadata: Record<string, unknown>;
}

/**
 * Map business-rule results (AI + code) to ValidationResult payloads, applying
 * the user-configured severity to decide what is stored and what flags the item.
 * Single source of truth shared by the worker and the recompare route.
 */
export function buildBusinessRuleValidations(
  businessRules: BusinessRule[],
  results: BusinessRuleResult[]
): { validations: BuiltValidation[]; anyFlag: boolean } {
  const byId = new Map(businessRules.map((r) => [r.id, r]));
  const byText = new Map(businessRules.map((r) => [r.rule, r]));
  const validations: BuiltValidation[] = [];
  let anyFlag = false;

  for (const r of results) {
    const matched = (r.ruleId ? byId.get(r.ruleId) : undefined) ?? byText.get(r.rule);
    const severity = matched?.severity ?? "warning";
    const outcome = resolveRuleOutcome(r.status, severity);
    if (outcome.flags) anyFlag = true;
    if (!outcome.store) continue;
    validations.push({
      ruleType: "BUSINESS_RULE",
      status: outcome.store,
      message: `${r.category}: ${r.rule}`,
      metadata: {
        rule: r.rule,
        category: r.category,
        severity,
        evidence: r.evidence,
        notes: r.notes,
        aiStatus: r.status,
        ...(r.visionVerification ? { visionVerification: r.visionVerification } : {}),
      },
    });
  }
  return { validations, anyFlag };
}
