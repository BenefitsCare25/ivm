import { FileText, Image as ImageIcon, File, type LucideIcon } from "lucide-react";

const MIME_ICONS: Record<string, LucideIcon> = {
  "application/pdf": FileText,
  "image/png": ImageIcon,
  "image/jpeg": ImageIcon,
  "image/webp": ImageIcon,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileText,
};

export function getMimeIcon(mimeType: string): LucideIcon {
  return MIME_ICONS[mimeType] ?? File;
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
