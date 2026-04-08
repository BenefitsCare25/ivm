import JSZip from "jszip";
import { randomUUID } from "crypto";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { normalizeDocxRuns } from "./docx-normalize";
import type { FillContext, FillFieldResult, FillerResult } from "./types";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function fillDocx(ctx: FillContext): Promise<FillerResult> {
  if (!ctx.storagePath) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "No DOCX file found in storage",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  const storage = getStorageAdapter();
  const originalBuffer = await storage.download(ctx.storagePath);
  const zip = await JSZip.loadAsync(originalBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "DOCX has no word/document.xml",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  let docXml = await docXmlFile.async("string");
  docXml = normalizeDocxRuns(docXml);
  const results: FillFieldResult[] = [];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const placeholderName = targetField?.name ?? mapping.targetFieldId;
    const label = targetField?.label ?? mapping.targetLabel;
    const placeholder = `{{${placeholderName}}}`;

    if (docXml.includes(placeholder)) {
      docXml = docXml.split(placeholder).join(escapeXml(value));
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: value,
        verifiedValue: null,
        status: "APPLIED",
        errorMessage: null,
      });
    } else {
      logger.warn({ placeholderName }, "DOCX placeholder not found as contiguous text");
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: `Placeholder "{{${placeholderName}}}" not found as contiguous text in document XML. It may be split across formatting runs.`,
      });
    }
  }

  zip.file("word/document.xml", docXml);
  const filledBuffer = Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  );

  const filledKey = `filled/${ctx.sessionId}/${randomUUID()}.docx`;
  await storage.upload(
    filledKey,
    filledBuffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

  for (const result of results) {
    if (result.status !== "APPLIED") continue;
    const targetField = ctx.targetFields.find((f) => f.id === result.targetFieldId);
    const placeholderName = targetField?.name ?? result.targetFieldId;

    if (
      !docXml.includes(`{{${placeholderName}}}`) &&
      docXml.includes(escapeXml(result.intendedValue))
    ) {
      result.verifiedValue = result.intendedValue;
      result.status = "VERIFIED";
    }
  }

  return {
    results,
    filledStoragePath: filledKey,
    webpageFillScript: null,
  };
}
