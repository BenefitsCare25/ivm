import { logger } from "@/lib/logger";
import { verifyWithVision } from "./vision-verify";
import { rasterizePdfToImages } from "./pdf-raster";
import { fieldNameMatchesPortal } from "@/lib/comparison-templates";
import type { AIProvider, RasterImage } from "./types";
import type {
  BusinessRule,
  BusinessRuleResult,
  FieldComparison,
  TemplateField,
} from "@/types/portal";

const MAX_VISION_VERIFICATIONS = 4;
const SUPPORTED_MIME = (m: string) =>
  m === "application/pdf" || m === "image/png" || m === "image/jpeg" || m === "image/webp";

export interface VisionCheckFile {
  originalName: string;
  storagePath: string;
  mimeType: string;
}

interface RunVisionChecksArgs {
  comparisonResult: {
    fieldComparisons: FieldComparison[];
    businessRuleResults?: BusinessRuleResult[];
    matchCount: number;
    mismatchCount: number;
  };
  fields: TemplateField[];
  businessRules: BusinessRule[];
  files: VisionCheckFile[];
  pdfFieldSources?: Record<string, string>;
  /** Buffers already downloaded earlier this job (avoids a second storage fetch). */
  preloadedBuffers?: Map<string, Buffer>;
  provider: AIProvider;
  apiKey: string;
  visionModel: string;
  baseURL?: string;
}

/**
 * Selectively re-check flagged results against the source document with a vision
 * model. Only fires on violations/mismatches for fields & rules the user marked
 * `verifyWithVision`, capped to control cost & latency. Mutates comparisonResult
 * in place (applying verdicts) and returns the count of checks performed.
 */
export async function runVisionChecks(args: RunVisionChecksArgs): Promise<number> {
  const { comparisonResult, fields, businessRules, files, pdfFieldSources, preloadedBuffers, provider, apiKey, visionModel, baseURL } = args;

  // Only verify against formats the vision model accepts.
  const usableFiles = files.filter((f) => SUPPORTED_MIME(f.mimeType));
  if (usableFiles.length === 0) return 0;

  const ruleById = new Map(businessRules.map((r) => [r.id, r]));
  const ruleByText = new Map(businessRules.map((r) => [r.rule, r]));

  type Task =
    | { kind: "field"; fc: FieldComparison; file: VisionCheckFile; question: string }
    | { kind: "rule"; br: BusinessRuleResult; file: VisionCheckFile; question: string };
  const tasks: Task[] = [];

  const pickFile = (preferredName?: string): VisionCheckFile => {
    if (preferredName) {
      const m = usableFiles.find((f) => f.originalName === preferredName);
      if (m) return m;
    }
    return usableFiles[0];
  };

  for (const fc of comparisonResult.fieldComparisons) {
    if (tasks.length >= MAX_VISION_VERIFICATIONS) break;
    if (fc.status !== "MISMATCH") continue;
    // Match the same way the template filter does (handles "Claim Amount / Total").
    const tf = fields.find((f) => fieldNameMatchesPortal(fc.fieldName, f.portalFieldName));
    if (!tf?.verifyWithVision) continue;
    tasks.push({
      kind: "field",
      fc,
      file: pickFile(pdfFieldSources?.[fc.fieldName]),
      question:
        `The portal record shows "${fc.fieldName}" = "${fc.pageValue ?? ""}". ` +
        `The text extracted from this document showed "${fc.pdfValue ?? "(none)"}". ` +
        `Looking at the ACTUAL document, is the portal value "${fc.pageValue ?? ""}" supported by the document? ` +
        `Answer CONFIRMED if the document does contain/support that value (so it is really a match), ` +
        `REFUTED if the document clearly shows a different value (a genuine mismatch).`,
    });
  }

  for (const br of comparisonResult.businessRuleResults ?? []) {
    if (tasks.length >= MAX_VISION_VERIFICATIONS) break;
    if (br.status !== "FAIL" && br.status !== "WARNING") continue;
    const rule = (br.ruleId ? ruleById.get(br.ruleId) : undefined) ?? ruleByText.get(br.rule);
    if (!rule?.verifyWithVision) continue;
    tasks.push({
      kind: "rule",
      br,
      file: pickFile(),
      question:
        `Rule: "${br.rule}". Based on the ACTUAL document, is this rule VIOLATED by this claim? ` +
        `Answer CONFIRMED if the rule is violated, REFUTED if the document shows the rule is satisfied (compliant).`,
    });
  }

  if (tasks.length === 0) return 0;

  // Pre-fetch each unique file once (seeded with buffers already in memory).
  const bufferCache = new Map<string, Buffer>(preloadedBuffers ?? []);
  const neededPaths = [...new Set(tasks.map((t) => t.file.storagePath))].filter((p) => !bufferCache.has(p));
  if (neededPaths.length > 0) {
    const { getStorageAdapter } = await import("@/lib/storage");
    const storage = getStorageAdapter();
    await Promise.all(
      neededPaths.map(async (p) => {
        try {
          bufferCache.set(p, await storage.download(p));
        } catch (err) {
          logger.warn({ err, storagePath: p }, "[vision-checks] file download failed (skipping)");
        }
      })
    );
  }

  // For local, rasterize each unique PDF ONCE (canvas render is the expensive step) and
  // reuse the pages across every task on that file, rather than re-decoding per task.
  const rasterCache = new Map<string, RasterImage[]>();
  if (provider === "local") {
    const pdfPaths = [
      ...new Set(tasks.filter((t) => t.file.mimeType === "application/pdf").map((t) => t.file.storagePath)),
    ];
    for (const p of pdfPaths) {
      const buf = bufferCache.get(p);
      if (!buf) continue;
      try {
        rasterCache.set(p, await rasterizePdfToImages(buf, { maxPages: 4 }));
      } catch (err) {
        logger.warn({ err, storagePath: p }, "[vision-checks] rasterize failed (will fall back per-task)");
      }
    }
  }

  // Run the (independent) verifications concurrently — they are bounded to
  // MAX_VISION_VERIFICATIONS and otherwise serialize on the worker's job timeout.
  let fieldChanged = false;
  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      const fileData = bufferCache.get(task.file.storagePath);
      if (!fileData) return false;
      const result = await verifyWithVision({
        question: task.question,
        fileData,
        mimeType: task.file.mimeType,
        fileName: task.file.originalName,
        provider,
        apiKey,
        model: visionModel,
        baseURL,
        images: rasterCache.get(task.file.storagePath),
      });

      if (task.kind === "field") {
        task.fc.visionVerification = { ...result, sourceFile: task.file.originalName };
        if (result.verdict === "CONFIRMED") {
          task.fc.status = "MATCH";
          task.fc.notes = `${task.fc.notes ? task.fc.notes + " " : ""}[Vision-verified: ${result.explanation}]`;
          fieldChanged = true;
        }
      } else {
        task.br.visionVerification = { ...result, sourceFile: task.file.originalName };
        if (result.verdict === "REFUTED") {
          task.br.status = "PASS";
          task.br.notes = `${task.br.notes ? task.br.notes + " " : ""}[Vision-verified compliant: ${result.explanation}]`;
        }
      }
      return true;
    })
  );

  const performed = settled.filter((s) => s.status === "fulfilled" && s.value === true).length;

  // Recompute field counts only if a field verdict actually flipped.
  if (fieldChanged) {
    comparisonResult.matchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MATCH").length;
    comparisonResult.mismatchCount = comparisonResult.fieldComparisons.filter((c) => c.status === "MISMATCH").length;
  }

  logger.info({ performed, queued: tasks.length }, "[vision-checks] completed selective vision verification");
  return performed;
}
