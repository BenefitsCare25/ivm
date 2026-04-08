import type { TargetType } from "@/types/target";
import { inspectWebpage, type InspectResult } from "./inspect-webpage";
import { inspectPdf } from "./inspect-pdf";
import { inspectDocx } from "./inspect-docx";

export type { InspectResult };

export async function inspectTarget(
  targetType: TargetType,
  options: { url?: string; buffer?: Buffer }
): Promise<InspectResult> {
  switch (targetType) {
    case "WEBPAGE": {
      if (!options.url) {
        return { fields: [], isSupported: false, unsupportedReason: "URL is required" };
      }
      return inspectWebpage(options.url);
    }
    case "PDF": {
      if (!options.buffer) {
        return { fields: [], isSupported: false, unsupportedReason: "File buffer is required" };
      }
      return inspectPdf(options.buffer);
    }
    case "DOCX": {
      if (!options.buffer) {
        return { fields: [], isSupported: false, unsupportedReason: "File buffer is required" };
      }
      return inspectDocx(options.buffer);
    }
  }
}
