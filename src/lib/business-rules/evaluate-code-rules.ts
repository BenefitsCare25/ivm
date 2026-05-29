import type { BusinessRule, BusinessRuleResult, CodeRuleOperator } from "@/types/portal";

function normalizeKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Resolve a field value from merged page+pdf data. Matching is predictable for
 * deterministic code rules: exact (case/space-insensitive) first, then an
 * UNAMBIGUOUS prefix match (e.g. "Outstanding Balance" ↔ "Outstanding Balance (SGD)").
 * Substring guessing is deliberately avoided — "Amount" must not silently bind to
 * "GST Amount", nor "Paid" to "Unpaid". When the match is ambiguous or absent,
 * returns undefined so the rule surfaces as NOT_APPLICABLE rather than flagging on
 * the wrong field.
 */
export function resolveFieldValue(
  fieldName: string,
  data: Record<string, string>
): string | undefined {
  const target = normalizeKey(fieldName);
  for (const [k, v] of Object.entries(data)) {
    if (normalizeKey(k) === target) return v;
  }
  const prefixMatches = Object.entries(data).filter(([k]) => {
    const nk = normalizeKey(k);
    return nk.startsWith(target) || target.startsWith(nk);
  });
  return prefixMatches.length === 1 ? prefixMatches[0][1] : undefined;
}

/** Parse a numeric value, stripping currency symbols, thousands separators, and whitespace. */
export function parseNumeric(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isEmptyValue(v: string | undefined): boolean {
  return v == null || v.trim() === "";
}

function compare(
  operator: CodeRuleOperator,
  actual: string | undefined,
  expected: string | undefined
): { pass: boolean; reason: string } {
  switch (operator) {
    case "is_empty":
      return { pass: isEmptyValue(actual), reason: isEmptyValue(actual) ? "field is empty" : `field = "${actual}"` };
    case "not_empty":
      return { pass: !isEmptyValue(actual), reason: isEmptyValue(actual) ? "field is empty" : `field = "${actual}"` };
    case "eq":
    case "ne": {
      const an = parseNumeric(actual);
      const en = parseNumeric(expected);
      let equal: boolean;
      if (an != null && en != null) {
        equal = Math.abs(an - en) < 0.0001;
      } else {
        equal = (actual ?? "").trim().toLowerCase() === (expected ?? "").trim().toLowerCase();
      }
      const pass = operator === "eq" ? equal : !equal;
      return { pass, reason: `"${actual ?? ""}" ${operator === "eq" ? "==" : "!="} "${expected ?? ""}"` };
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const an = parseNumeric(actual);
      const en = parseNumeric(expected);
      if (an == null || en == null) {
        return { pass: false, reason: `non-numeric comparison ("${actual ?? ""}" vs "${expected ?? ""}")` };
      }
      const pass =
        operator === "gt" ? an > en :
        operator === "gte" ? an >= en :
        operator === "lt" ? an < en :
        an <= en;
      return { pass, reason: `${an} ${operator} ${en}` };
    }
    default:
      return { pass: false, reason: "unknown operator" };
  }
}

/**
 * Evaluate deterministic code rules against merged claim data.
 * Returns BusinessRuleResult[] matching the AI result shape so both can be merged.
 * A rule PASSES when the configured condition is satisfied; FAILS when violated;
 * NOT_APPLICABLE when the referenced field is absent (binary operators only).
 */
export function evaluateCodeRules(
  rules: BusinessRule[],
  data: Record<string, string>
): BusinessRuleResult[] {
  return rules
    .filter((r) => r.type === "code" && r.field && r.operator)
    .map((r) => {
    const actual = resolveFieldValue(r.field!, data);
    const isUnary = r.operator === "is_empty" || r.operator === "not_empty";

    const ruleText = r.rule || `${r.field} ${r.operator} ${r.compareField ?? r.value ?? ""}`.trim();

    if (!isUnary && actual === undefined) {
      return {
        rule: ruleText,
        ruleId: r.id,
        category: r.category,
        status: "NOT_APPLICABLE" as const,
        evidence: `Field "${r.field}" not found in claim data`,
      };
    }

    const expected = r.compareField
      ? resolveFieldValue(r.compareField, data)
      : r.value;

    // A binary operator with no usable comparison value (missing compareField or
    // unconfigured value) is a misconfiguration, not a violation — never flag on it.
    if (!isUnary && (expected === undefined || expected === "")) {
      return {
        rule: ruleText,
        ruleId: r.id,
        category: r.category,
        status: "NOT_APPLICABLE" as const,
        evidence: r.compareField
          ? `Compare field "${r.compareField}" not found in claim data`
          : `No comparison value configured`,
      };
    }

    const { pass, reason } = compare(r.operator!, actual, expected);

    return {
      rule: ruleText,
      ruleId: r.id,
      category: r.category,
      status: pass ? ("PASS" as const) : ("FAIL" as const),
      evidence: `Code rule: ${reason}`,
    };
  });
}

/**
 * Append deterministic code-rule results to the AI-produced results. Shared by
 * the worker and the recompare route so both evaluate code rules identically.
 */
export function withCodeRuleResults(
  existing: BusinessRuleResult[] | undefined,
  rules: BusinessRule[],
  data: Record<string, string>
): BusinessRuleResult[] {
  const code = evaluateCodeRules(rules, data);
  if (code.length === 0) return existing ?? [];
  return [...(existing ?? []), ...code];
}
