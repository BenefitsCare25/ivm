import { parseDisplayDate } from "@/lib/date-utils";

export interface SubmittedDateRange {
  /** Inclusive lower bound, ISO `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound, ISO `YYYY-MM-DD`. */
  to?: string;
}

export interface SubmittedFilterResult<T> {
  kept: T[];
  /** Whether the filter actually ran (a range was set AND a submitted column was found). */
  applied: boolean;
  /** Rows dropped because their submitted date could not be parsed. */
  droppedNoDate: number;
  /** Rows dropped because their submitted date fell outside the range. */
  droppedOutOfRange: number;
}

// Matches "Submitted On", "Submission Date", "Date Submitted", etc.
const SUBMITTED_COL = /submitt|submission/i;

/**
 * Locate the field key holding the submission date. Prefers an exact
 * "Submitted On" column, then falls back to any submitted/submission-like key.
 * Portal rows share the same columns, so the first row with a match wins.
 */
export function findSubmittedKey(fields: Record<string, string>): string | null {
  const keys = Object.keys(fields);
  const exact = keys.find((k) => k.trim().toLowerCase() === "submitted on");
  if (exact) return exact;
  return keys.find((k) => SUBMITTED_COL.test(k)) ?? null;
}

/**
 * Filter scraped list rows by their "Submitted On" date against an inclusive
 * range. Applied before TrackedItems are created, so out-of-range claims are
 * never detail-scraped or compared.
 *
 * Resilience: if no submitted-date column exists in any row, the filter is
 * skipped (all rows kept, `applied:false`) rather than silently dropping the
 * whole scrape on a column-name mismatch. When the column IS present, rows with
 * an unparseable/empty date are dropped and counted (never silently kept).
 */
export function filterBySubmittedDate<T extends { fields: Record<string, string> }>(
  rows: T[],
  range: SubmittedDateRange
): SubmittedFilterResult<T> {
  const from = range.from?.trim() || undefined;
  const to = range.to?.trim() || undefined;

  if (!from && !to) {
    return { kept: rows, applied: false, droppedNoDate: 0, droppedOutOfRange: 0 };
  }

  let key: string | null = null;
  for (const row of rows) {
    key = findSubmittedKey(row.fields);
    if (key) break;
  }
  if (!key) {
    return { kept: rows, applied: false, droppedNoDate: 0, droppedOutOfRange: 0 };
  }

  let droppedNoDate = 0;
  let droppedOutOfRange = 0;
  const kept = rows.filter((row) => {
    const iso = parseDisplayDate(row.fields[key!] ?? "");
    if (!iso) {
      droppedNoDate++;
      return false;
    }
    if (from && iso < from) {
      droppedOutOfRange++;
      return false;
    }
    if (to && iso > to) {
      droppedOutOfRange++;
      return false;
    }
    return true;
  });

  return { kept, applied: true, droppedNoDate, droppedOutOfRange };
}
