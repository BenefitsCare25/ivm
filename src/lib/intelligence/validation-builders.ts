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

/** REQUIRED_DOCUMENT rows for every unfound required document. */
export function buildRequiredDocValidations(
  checks: RequiredDocumentCheck[] | undefined,
  requiredDocuments: RequiredDocument[]
): ValidationRowData[] {
  if (!checks) return [];
  const rdByName = new Map(requiredDocuments.map((rd) => [rd.documentTypeName, rd]));

  return checks
    .filter((d) => !d.found)
    .map((d) => {
      const matchedReqDoc = rdByName.get(d.documentTypeName);
      // Confidence gating: low-confidence detections are surfaced as a
      // "manual review recommended" WARNING rather than a hard "missing" FAIL.
      const isUncertain = d.uncertain === true;
      return {
        ruleType: "REQUIRED_DOCUMENT",
        status: (isUncertain ? "WARNING" : "FAIL") as ValidationRowData["status"],
        message: isUncertain
          ? `Manual review recommended: "${d.documentTypeName}" could not be confidently identified among the submitted files`
          : `Required document not found: ${d.documentTypeName}`,
        metadata: {
          documentTypeName: d.documentTypeName,
          group: matchedReqDoc?.group ?? null,
          notes: d.notes ?? null,
          confidence: d.confidence ?? null,
          matchedVia: d.matchedVia ?? null,
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
