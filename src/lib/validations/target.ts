import { z } from "zod";

export const targetWebpageSchema = z.object({
  targetType: z.literal("WEBPAGE"),
  url: z.string().url("Must be a valid URL").max(2000, "URL too long"),
});

export type TargetWebpageInput = z.infer<typeof targetWebpageSchema>;

export const targetFileSchema = z.object({
  targetType: z.enum(["PDF", "DOCX"]),
});

export const TARGET_MIME_TYPES = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export const TARGET_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateTargetFile(
  file: { size: number; type: string; name: string },
  targetType: "PDF" | "DOCX"
): { valid: boolean; error?: string } {
  const expectedMime = TARGET_MIME_TYPES[targetType];
  if (file.type !== expectedMime) {
    return { valid: false, error: `Expected ${targetType} file, got ${file.type}` };
  }
  if (file.size > TARGET_MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum: 10 MB" };
  }
  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  return { valid: true };
}
