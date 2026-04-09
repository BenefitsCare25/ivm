import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFormatter = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(date: Date | string): string {
  return dateFormatter.format(new Date(date));
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

export function formatFieldLabel(name: string): string {
  return name.replace(/[_.-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function confidenceVariant(confidence: number): "success" | "warning" | "error" {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "error";
}

/** Cast a value to Prisma's InputJsonValue by stripping undefined via serialization. */
export function toInputJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
