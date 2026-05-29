import type { BusinessRuleSeverity } from "@/types/portal";

export type AiRuleStatus = "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE";

export interface RuleOutcome {
  /** ValidationResult status to persist, or null to not record (compliant / N/A). */
  store: "FAIL" | "WARNING" | null;
  /** Whether this violation contributes to the item being FLAGGED. */
  flags: boolean;
}

/**
 * Resolve how a rule result maps to an item-level outcome, driven by the
 * user-configured severity (not just the model's PASS/FAIL judgment).
 *
 * - PASS / NOT_APPLICABLE      → never recorded, never flags.
 * - severity "info"            → recorded as a WARNING note, but never flags the item.
 * - severity "warning"         → recorded as WARNING and flags the item.
 * - severity "critical" + FAIL → recorded as FAIL and flags the item.
 * - severity "critical" + WARNING (ambiguous) → recorded as WARNING and flags.
 */
export function resolveRuleOutcome(
  aiStatus: AiRuleStatus,
  severity: BusinessRuleSeverity
): RuleOutcome {
  if (aiStatus === "PASS" || aiStatus === "NOT_APPLICABLE") {
    return { store: null, flags: false };
  }
  if (severity === "info") {
    return { store: "WARNING", flags: false };
  }
  if (severity === "critical") {
    return { store: aiStatus === "FAIL" ? "FAIL" : "WARNING", flags: true };
  }
  // severity === "warning"
  return { store: "WARNING", flags: true };
}
