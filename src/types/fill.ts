export type FillActionStatus = "PENDING" | "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";

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
