import type { TargetType, TargetField } from "@/types/target";
import type { FieldMapping } from "@/types/mapping";
import type { WebpageFillOp } from "@/types/fill";

export type { WebpageFillOp };

export interface FillContext {
  sessionId: string;
  mappingSetId: string;
  targetType: TargetType;
  targetFields: TargetField[];
  approvedMappings: FieldMapping[];
  storagePath: string | null;
  targetUrl: string | null;
  targetFileName: string | null;
}

export interface FillFieldResult {
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  appliedValue: string | null;
  verifiedValue: string | null;
  status: "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";
  errorMessage: string | null;
}

export interface FillerResult {
  results: FillFieldResult[];
  filledStoragePath: string | null;
  webpageFillScript: string | null;
  /** Structured operations for extension safe-fill (preferred over script) */
  webpageFillOperations: WebpageFillOp[] | null;
}
