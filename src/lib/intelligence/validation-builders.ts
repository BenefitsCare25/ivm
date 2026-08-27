import type {
  RequiredDocument,
  RequiredDocumentCheck,
  BillStatusSignal,
} from "@/types/portal";

/**
 * Single source of truth for the ValidationResult rows produced by the
 * required-document and bill-status checks. Used by BOTH the detail worker and
 * the recompare route so the same item yields identical alerts regardless of
 * which path processed it. Returns plain data (metadata as a JS object); callers
 * add `trackedItemId` and wrap metadata with `toInputJson`.
 */

export interface ValidationRowData {
  ruleType: string;
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  metadata: Record<string, unknown>;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function missingCheck(requirement: RequiredDocument): RequiredDocumentCheck {
  return {
    documentTypeName: requirement.documentTypeName,
    found: false,
    confidence: 0,
    matchedVia: "none",
  };
}

function requiredDocumentFailures(
  checks: RequiredDocumentCheck[] | undefined,
  requiredDocuments: RequiredDocument[]
): Array<{
  requirements: RequiredDocument[];
  checks: RequiredDocumentCheck[];
  group: string | null;
  uncertain: boolean;
}> {
  const byName = new Map(
    (checks ?? []).map((check) => [normalizedName(check.documentTypeName), check])
  );
  const failures: Array<{
    requirements: RequiredDocument[];
    checks: RequiredDocumentCheck[];
    group: string | null;
    uncertain: boolean;
  }> = [];

  for (const requirement of requiredDocuments.filter((doc) => doc.rule === "required")) {
    const check = byName.get(normalizedName(requirement.documentTypeName)) ?? missingCheck(requirement);
    if (!check.found) {
      failures.push({
        requirements: [requirement],
        checks: [check],
        group: requirement.group?.trim() || null,
        uncertain: check.uncertain === true,
      });
    }
  }

  const oneOfGroups = new Map<string, RequiredDocument[]>();
  for (const requirement of requiredDocuments.filter((doc) => doc.rule === "one_of")) {
    // Ungrouped `one_of` rows form one backwards-compatible default group.
    const group = requirement.group?.trim() || "__default_one_of";
    oneOfGroups.set(group, [...(oneOfGroups.get(group) ?? []), requirement]);
  }
  for (const [groupKey, requirements] of oneOfGroups) {
    const groupChecks = requirements.map(
      (requirement) =>
        byName.get(normalizedName(requirement.documentTypeName)) ?? missingCheck(requirement)
    );
    if (groupChecks.some((check) => check.found)) continue;
    failures.push({
      requirements,
      checks: groupChecks,
      group: groupKey === "__default_one_of" ? null : groupKey,
      uncertain: groupChecks.some((check) => check.uncertain === true),
    });
  }

  return failures;
}

/** True only when a required entry or an entire one-of group is unsatisfied. */
export function hasUnsatisfiedRequiredDocuments(
  checks: RequiredDocumentCheck[] | undefined,
  requiredDocuments: RequiredDocument[]
): boolean {
  return requiredDocumentFailures(checks, requiredDocuments).length > 0;
}

/** REQUIRED_DOCUMENT rows for every unfound required document. */
export function buildRequiredDocValidations(
  checks: RequiredDocumentCheck[] | undefined,
  requiredDocuments: RequiredDocument[]
): ValidationRowData[] {
  return requiredDocumentFailures(checks, requiredDocuments).map((failure) => {
    const alternatives = failure.requirements.map((doc) => doc.documentTypeName);
    const check = failure.checks[0];
    const isGroup = failure.requirements.length > 1 || failure.requirements[0]?.rule === "one_of";
    const label = alternatives.join(" or ");
    const isUncertain = failure.uncertain;
    return {
      ruleType: "REQUIRED_DOCUMENT",
      status: (isUncertain ? "WARNING" : "FAIL") as ValidationRowData["status"],
      message: isUncertain
        ? `Manual review recommended: ${isGroup ? `none of ${label}` : `"${label}"`} could be confidently identified among the submitted files`
        : isGroup
          ? `Required document group not satisfied: submit one of ${label}`
          : `Required document not found: ${label}`,
      metadata: {
        documentTypeName: isGroup ? null : alternatives[0],
        alternatives,
        group: failure.group,
        notes: failure.checks.map((item) => item.notes).filter(Boolean),
        confidence: Math.max(...failure.checks.map((item) => item.confidence ?? 0)),
        matchedVia: check?.matchedVia ?? null,
        severity: isUncertain ? "review" : "critical",
      },
    };
  });
}

/** Optional BILL_STATUS informational row (interim vs final). */
export function buildBillStatusValidation(
  signal: BillStatusSignal | null
): ValidationRowData | null {
  if (!signal || signal.status === "unknown") return null;
  const balance = signal.outstandingBalance;
  const balanceNote = balance ? ` Outstanding balance: ${balance.value} (${balance.label}).` : "";
  return {
    ruleType: "BILL_STATUS",
    status: "WARNING",
    message:
      signal.status === "interim"
        ? `Interim bill submitted — not the final bill.${balanceNote}`
        : `Final bill detected.${balanceNote}`,
    metadata: {
      billStatus: signal.status,
      fileName: signal.fileName,
      evidence: signal.evidence,
      outstandingBalance: balance ?? null,
      severity: "info",
    },
  };
}
