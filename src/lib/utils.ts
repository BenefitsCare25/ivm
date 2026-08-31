import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DetailSelectors, ListSelectors } from "@/types/portal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOptionalSelector(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const selector = value.trim();
  return selector.length > 0 ? selector : undefined;
}

export function normalizeListSelectors(value: unknown): ListSelectors {
  const selectors = isRecord(value) ? value : {};
  const columns = Array.isArray(selectors.columns)
    ? selectors.columns.flatMap((column) => {
        if (!isRecord(column) || typeof column.name !== "string") return [];

        const name = column.name.trim();
        const selector = normalizeOptionalSelector(column.selector);
        return name && selector ? [{ name, selector }] : [];
      })
    : undefined;

  return {
    tableSelector: normalizeOptionalSelector(selectors.tableSelector),
    rowSelector: normalizeOptionalSelector(selectors.rowSelector),
    columns,
    detailLinkSelector: normalizeOptionalSelector(selectors.detailLinkSelector),
    paginationSelector: normalizeOptionalSelector(selectors.paginationSelector),
  };
}

export function normalizeDetailSelectors(value: unknown): DetailSelectors {
  const selectors = isRecord(value) ? value : {};
  const rawFieldSelectors = isRecord(selectors.fieldSelectors)
    ? selectors.fieldSelectors
    : {};
  const fieldSelectors: Record<string, string> = {};

  for (const [rawName, rawSelector] of Object.entries(rawFieldSelectors)) {
    const name = rawName.trim();
    const selector = normalizeOptionalSelector(rawSelector);
    if (name && selector) fieldSelectors[name] = selector;
  }

  return {
    fieldSelectors:
      Object.keys(fieldSelectors).length > 0 ? fieldSelectors : undefined,
    readySelector: normalizeOptionalSelector(selectors.readySelector),
    downloadLinkSelector: normalizeOptionalSelector(
      selectors.downloadLinkSelector,
    ),
    fileNameSelector: normalizeOptionalSelector(selectors.fileNameSelector),
  };
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFormatter = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Singapore",
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

export function toSGTDateStr(utcDate: Date): string {
  const sgt = new Date(utcDate.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().split("T")[0];
}
