import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";
import type { FillContext, FillerResult } from "./types";
import { fillPdf } from "./pdf-filler";
import { fillDocx } from "./docx-filler";
import { fillWebpage } from "./webpage-filler";

export function buildFillContext(params: {
  sessionId: string;
  mappingSetId: string;
  targetType: TargetType;
  targetFields: TargetField[];
  mappings: FieldMapping[];
  storagePath: string | null;
  targetUrl: string | null;
  targetFileName: string | null;
  skipFieldIds?: string[];
  retryFieldIds?: string[];
}): FillContext {
  const approved = params.mappings.filter((m) => {
    if (!m.userApproved) return false;
    if (m.sourceFieldId === null && !m.userOverrideValue) return false;
    if (params.skipFieldIds?.includes(m.targetFieldId)) return false;
    if (params.retryFieldIds && !params.retryFieldIds.includes(m.targetFieldId)) return false;
    return true;
  });

  return {
    sessionId: params.sessionId,
    mappingSetId: params.mappingSetId,
    targetType: params.targetType,
    targetFields: params.targetFields,
    approvedMappings: approved,
    storagePath: params.storagePath,
    targetUrl: params.targetUrl,
    targetFileName: params.targetFileName,
  };
}

export async function executeFill(ctx: FillContext): Promise<FillerResult> {
  switch (ctx.targetType) {
    case "PDF":
      return fillPdf(ctx);
    case "DOCX":
      return fillDocx(ctx);
    case "WEBPAGE":
      return fillWebpage(ctx);
    default:
      throw new Error(`Unsupported target type: ${ctx.targetType}`);
  }
}
