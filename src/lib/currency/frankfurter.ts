import { logger } from "@/lib/logger";
import type { RateResult } from "./types";

/**
 * Frankfurter — free, keyless historical FX rates sourced from the European
 * Central Bank's daily reference rates (published ~16:00 CET on business days).
 *
 * Why this is the primary provider: MAS discontinued its free daily exchange-rate
 * feed (the old eservices `/statistics/api/v1/exchange-rate` endpoint now 404s and
 * the data.gov.sg daily datasets stop at 2015), so historical rates are no longer
 * freely extractable from MAS. Frankfurter covers every currency our detector
 * recognises (USD, EUR, GBP, MYR, AUD, JPY, CNY, HKD, THB, IDR, PHP, INR, NZD,
 * CAD, CHF) with data back to 1999.
 *
 * Weekend/holiday handling is automatic: a single-date query returns the rate for
 * that date OR the nearest prior published day, and echoes the actual date in the
 * response's `date` field — so no manual look-back window is needed. Dates beyond
 * the latest published rate (future dates) 404, which we resolve to `latest`.
 */

const BASE_URL = "https://api.frankfurter.dev/v1";

const today = (): string => new Date().toISOString().split("T")[0];

// Resolved-result cache: "CODE:requestedDate" → RateResult. A date's rate is
// immutable, so entries never go stale; bounded to avoid unbounded growth.
const cache = new Map<string, RateResult>();
const MAX_CACHE = 200;

function cacheSet(key: string, value: RateResult): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function fetchRate(pathDate: string, base: string): Promise<{ rate: number; date: string } | null> {
  const url = `${BASE_URL}/${pathDate}?base=${base}&symbols=SGD`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, base, pathDate }, "[frankfurter] API error");
      return null;
    }
    const json = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rate = json.rates?.SGD;
    if (typeof rate !== "number" || rate <= 0 || !json.date) return null;
    return { rate, date: json.date };
  } catch (err) {
    logger.warn({ err, base, pathDate }, "[frankfurter] Fetch failed");
    return null;
  }
}

/**
 * Resolve the SGD exchange rate for `currencyCode` on `requestedDate` (YYYY-MM-DD)
 * from Frankfurter/ECB. Returns null if the currency is SGD, is unsupported, or the
 * API is unreachable (so the caller can fall back to another provider).
 */
export async function getFrankfurterRate(
  currencyCode: string,
  requestedDate: string
): Promise<RateResult | null> {
  const code = currencyCode.toUpperCase();
  if (code === "SGD") return null;

  const cacheKey = `${code}:${requestedDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const isFuture = requestedDate > today();
  // Future dates have no published rate → use the latest available (an estimate).
  const queryDate = isFuture ? "latest" : requestedDate;

  const fetched = await fetchRate(queryDate, code);
  if (!fetched) return null;

  const result: RateResult = {
    rate: fetched.rate,
    actualDate: fetched.date,
    isFallback: fetched.date !== requestedDate,
    isFuture,
    isHistorical: !isFuture,
    source: "frankfurter",
  };

  cacheSet(cacheKey, result);
  logger.debug(
    { currency: code, requestedDate, actualDate: result.actualDate, rate: result.rate, isFuture },
    "[frankfurter] Rate resolved"
  );
  return result;
}
