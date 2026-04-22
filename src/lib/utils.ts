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

/** Strip undefined via JSON round-trip. Use for Prisma InputJsonValue fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toInputJson(value: any): any {
  return JSON.parse(JSON.stringify(value));
}

/** Generate a short random ID (8 chars, base-36). Suitable for transient client-side IDs. */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Toggle an item in an array: removes it if present, appends it if absent. */
export function toggleArrayItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}
