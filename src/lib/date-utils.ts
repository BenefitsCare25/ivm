const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * True only for a real calendar date in strict `YYYY-MM-DD` form. Rejects
 * format-valid-but-impossible dates (e.g. "2026-06-31", "2026-13-01") that a
 * bare regex would accept — `new Date()` silently rolls those over.
 */
export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Parse a human-displayed date string into an ISO `YYYY-MM-DD` date (no time).
 * Handles ISO, DD/MM/YYYY | MM/DD/YYYY (disambiguated by range, defaults DD/MM
 * for SG locale), `DD Mon YYYY` (e.g. "24 Jun 2026"), and `Mon DD, YYYY`.
 * Returns null when the value is empty or unrecognised.
 *
 * Shared by currency incurred-date resolution and the portal "Submitted On"
 * scrape filter so both parse portal/document dates identically.
 */
export function parseDisplayDate(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;

  // YYYY-MM-DD (ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const iso = cleaned.slice(0, 10);
    if (!isNaN(new Date(iso).getTime())) return iso;
  }

  // DD/MM/YYYY or MM/DD/YYYY — disambiguate by range
  const slashed = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashed) {
    const [, a, b, yyyy] = slashed;
    const n1 = parseInt(a, 10);
    const n2 = parseInt(b, 10);

    let dd: string, mm: string;
    if (n2 > 12) {
      // Second number can't be a month → must be MM/DD/YYYY
      mm = a; dd = b;
    } else if (n1 > 12) {
      // First number can't be a month → must be DD/MM/YYYY
      dd = a; mm = b;
    } else {
      // Both ≤ 12: ambiguous — default DD/MM (SG locale)
      dd = a; mm = b;
    }

    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }

  // DD Mon YYYY  (e.g. "24 Jun 2026")
  const ddmonyyyy = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (ddmonyyyy) {
    const [, dd, mon, yyyy] = ddmonyyyy;
    const mm = MONTH_ABBR[mon.toLowerCase()];
    if (mm) {
      const iso = `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }

  // Mon DD, YYYY  (e.g. "Jun 24, 2026")
  const monddyyyy = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monddyyyy) {
    const [, mon, dd, yyyy] = monddyyyy;
    const mm = MONTH_ABBR[mon.toLowerCase()];
    if (mm) {
      const iso = `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }

  return null;
}
