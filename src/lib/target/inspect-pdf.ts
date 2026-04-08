import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from "pdf-lib";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";
import { formatFieldLabel } from "@/lib/utils";
import type { InspectResult } from "./inspect-webpage";

export async function inspectPdf(buffer: Buffer): Promise<InspectResult> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: "Could not parse PDF (corrupt or encrypted)",
    };
  }

  let form;
  try {
    form = pdf.getForm();
  } catch {
    return { fields: [], isSupported: true };
  }

  const pdfFields = form.getFields();
  const fields: TargetField[] = [];

  for (const field of pdfFields) {
    const name = field.getName();
    let fieldType: TargetField["fieldType"] = "other";
    let currentValue: string | undefined;
    let options: string[] | undefined;

    if (field instanceof PDFTextField) {
      fieldType = "text";
      currentValue = field.getText() ?? undefined;
    } else if (field instanceof PDFCheckBox) {
      fieldType = "checkbox";
      currentValue = field.isChecked() ? "true" : "false";
    } else if (field instanceof PDFDropdown) {
      fieldType = "select";
      options = field.getOptions();
      const selected = field.getSelected();
      currentValue = selected.length > 0 ? selected[0] : undefined;
    } else if (field instanceof PDFRadioGroup) {
      fieldType = "radio";
      options = field.getOptions();
      currentValue = field.getSelected() ?? undefined;
    } else if (field instanceof PDFOptionList) {
      fieldType = "select";
      options = field.getOptions();
      const selected = field.getSelected();
      currentValue = selected.length > 0 ? selected[0] : undefined;
    }

    fields.push({
      id: randomUUID(),
      name,
      label: formatFieldLabel(name),
      fieldType,
      required: false,
      currentValue,
      options,
    });
  }

  return { fields, isSupported: true };
}
