import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from "pdf-lib";
import { randomUUID } from "crypto";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import type { FillContext, FillFieldResult, FillerResult } from "./types";

const TRUTHY_VALUES = new Set(["true", "yes", "1", "checked", "on"]);

export async function fillPdf(ctx: FillContext): Promise<FillerResult> {
  if (!ctx.storagePath) {
    return {
      results: ctx.approvedMappings.map((m) => ({
        targetFieldId: m.targetFieldId,
        targetLabel: m.targetLabel,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED" as const,
        errorMessage: "No PDF file found in storage",
      })),
      filledStoragePath: null,
      webpageFillScript: null,
    };
  }

  const storage = getStorageAdapter();
  const originalBuffer = await storage.download(ctx.storagePath);
  const pdf = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
  const form = pdf.getForm();

  const results: FillFieldResult[] = [];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const fieldName = targetField?.name ?? mapping.targetFieldId;
    const label = targetField?.label ?? mapping.targetLabel;

    try {
      const pdfField = form.getField(fieldName);

      if (pdfField instanceof PDFTextField) {
        pdfField.setText(value);
      } else if (pdfField instanceof PDFCheckBox) {
        if (TRUTHY_VALUES.has(value.toLowerCase())) {
          pdfField.check();
        } else {
          pdfField.uncheck();
        }
      } else if (pdfField instanceof PDFDropdown) {
        pdfField.select(value);
      } else if (pdfField instanceof PDFRadioGroup) {
        pdfField.select(value);
      } else if (pdfField instanceof PDFOptionList) {
        pdfField.select(value);
      } else {
        results.push({
          targetFieldId: mapping.targetFieldId,
          targetLabel: label,
          intendedValue: value,
          appliedValue: null,
          verifiedValue: null,
          status: "FAILED",
          errorMessage: `Unsupported PDF field type for "${fieldName}"`,
        });
        continue;
      }

      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: value,
        verifiedValue: null,
        status: "APPLIED",
        errorMessage: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.warn({ fieldName, error: msg }, "PDF fill failed for field");
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: `Could not fill field "${fieldName}": ${msg}`,
      });
    }
  }

  const filledBytes = await pdf.save();
  const filledBuffer = Buffer.from(filledBytes);
  const filledKey = `filled/${ctx.sessionId}/${randomUUID()}.pdf`;
  await storage.upload(filledKey, filledBuffer, "application/pdf");

  const verifyPdf = await PDFDocument.load(filledBuffer, { ignoreEncryption: true });
  const verifyForm = verifyPdf.getForm();

  for (const result of results) {
    if (result.status !== "APPLIED") continue;

    const targetField = ctx.targetFields.find((f) => f.id === result.targetFieldId);
    const fieldName = targetField?.name ?? result.targetFieldId;

    try {
      const field = verifyForm.getField(fieldName);
      let readBack: string | null = null;

      if (field instanceof PDFTextField) {
        readBack = field.getText() ?? null;
      } else if (field instanceof PDFCheckBox) {
        readBack = field.isChecked() ? "true" : "false";
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const selected = field.getSelected();
        readBack = selected.length > 0 ? selected[0] : null;
      } else if (field instanceof PDFRadioGroup) {
        readBack = field.getSelected() ?? null;
      }

      result.verifiedValue = readBack;
      result.status = "VERIFIED";
    } catch {
      // Keep APPLIED status — verification is best-effort
    }
  }

  return {
    results,
    filledStoragePath: filledKey,
    webpageFillScript: null,
  };
}
