import { getFrankfurterRate } from "./frankfurter";
import { getExchangeRateSgd } from "./exchangerate-api";
import type { RateResult } from "./types";

export type { RateResult };
export { getFrankfurterRate } from "./frankfurter";

/**
 * Resolve SGD exchange rate for a currency on a given date.
 *
 * Strategy:
 * 1. Frankfurter (ECB) — free, keyless, date-accurate historical rates covering
 *    all currencies we detect. Primary source.
 * 2. ExchangeRate-API — fallback when Frankfurter is unreachable or lacks the
 *    currency. Historical only on paid plans; otherwise returns the latest rate.
 *
 * (MAS's free daily feed was retired — its old API 404s and its data.gov.sg daily
 * datasets end in 2015 — so it is no longer used.)
 */
export async function resolveSgdRate(
  currencyCode: string,
  date: string
): Promise<RateResult | null> {
  const frankfurter = await getFrankfurterRate(currencyCode, date);
  if (frankfurter !== null) return frankfurter;

  return getExchangeRateSgd(currencyCode, date);
}
