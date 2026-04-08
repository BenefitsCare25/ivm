export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const ALLOWED_EXTENSIONS: Record<AllowedMimeType, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const ACCEPT_STRING = Object.values(ALLOWED_EXTENSIONS).join(",");

export const EXTENSION_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_EXTENSIONS).map(([mime, ext]) => [ext, mime])
);
// Also support .jpeg as alias for .jpg
EXTENSION_TO_MIME[".jpeg"] = "image/jpeg";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUploadFile(file: { size: number; type: string; name: string }): ValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMimeType)) {
    const allowed = Object.values(ALLOWED_EXTENSIONS).join(", ");
    return { valid: false, error: `Unsupported file type. Allowed: ${allowed}` };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum size: ${formatFileSize(MAX_FILE_SIZE)}` };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  return { valid: true };
}
