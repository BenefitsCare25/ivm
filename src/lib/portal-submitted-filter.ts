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

const SUBMITTED_HINT = /submitt|submission/i;
// A date-bearing column names one of these (e.g. "Submitted On", "Submission Date").
const DATELIKE_HINT = /\bon\b|date|\bdt\b/i;
// A person/actor column ("Submitted By", "Submitted By User") — must NOT be
// mistaken for the date column, or every row's name value fails to parse and
// the whole scrape is dropped.
const PERSON_HINT = /\bby\b|user|name|staff|officer|employee|person/i;

/**
 * Locate the field key holding the submission DATE. Prefers an exact
 * "Submitted On" column, then a submitted/submission column that also looks
 * date-bearing and is not an actor column. Deliberately strict: a bare
 * "Submitted By" (a name) is excluded so the filter never drops every row by
 * trying to parse names as dates. Portal rows share columns, so any row works.
 */
export function findSubmittedKey(fields: Record<string, string>): string | null {
  const keys = Object.keys(fields);
  const exact = keys.find((k) => k.trim().toLowerCase() === "submitted on");
  if (exact) return exact;
  return (
    keys.find(
      (k) => SUBMITTED_HINT.test(k) && DATELIKE_HINT.test(k) && !PERSON_HINT.test(k)
    ) ?? null
  );
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
