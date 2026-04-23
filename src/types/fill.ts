export type FillActionStatus = "PENDING" | "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";

export type FillState = "idle" | "processing" | "completed" | "failed";

export interface FillActionSummary {
  id: string;
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  appliedValue: string | null;
  verifiedValue: string | null;
  status: FillActionStatus;
  errorMessage: string | null;
}

export interface FillReport {
  total: number;
  applied: number;
  verified: number;
  failed: number;
  skipped: number;
}

export interface WebpageFillOp {
  selector: string;
  value: string | boolean;
  type: "value" | "check" | "click";
}

export interface FillSessionData {
  actions: FillActionSummary[];
  report: FillReport;
  hasFilledDocument: boolean;
  webpageFillScript: string | null;
  webpageFillOperations: WebpageFillOp[] | null;
}

export interface WebpageFillScript {
  script: string;
  fieldCount: number;
  targetUrl: string;
}

export function buildFillReport(actions: FillActionSummary[]): FillReport {
  return {
    total: actions.length,
    applied: actions.filter((a) => a.status === "APPLIED").length,
    verified: actions.filter((a) => a.status === "VERIFIED").length,
    failed: actions.filter((a) => a.status === "FAILED").length,
    skipped: actions.filter((a) => a.status === "SKIPPED").length,
  };
}

export function toFillActionSummary(
  fa: {
    id: string;
    targetFieldId: string;
    intendedValue: string;
    appliedValue: string | null;
    verifiedValue: string | null;
    status: string;
    errorMessage: string | null;
  },
  targetFields: { id: string; label?: string }[],
  mappings: { targetFieldId: string; targetLabel: string }[],
): FillActionSummary {
  const tf = targetFields.find((f) => f.id === fa.targetFieldId);
  const mapping = mappings.find((m) => m.targetFieldId === fa.targetFieldId);
  return {
    id: fa.id,
    targetFieldId: fa.targetFieldId,
    targetLabel: tf?.label ?? mapping?.targetLabel ?? fa.targetFieldId,
    intendedValue: fa.intendedValue,
    appliedValue: fa.appliedValue,
    verifiedValue: fa.verifiedValue,
    status: fa.status as FillActionStatus,
    errorMessage: fa.errorMessage,
  };
}
