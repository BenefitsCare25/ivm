import { getSgdRate } from "./mas-rates";
import { getExchangeRateSgd } from "./exchangerate-api";
import type { RateResult } from "./mas-rates";

export type { RateResult };
export { getSgdRate } from "./mas-rates";

/**
 * Resolve SGD exchange rate for a currency on a given date.
 *
 * Strategy:
 * 1. MAS API — official Singapore government historical rates, 18 currencies.
 *    Used first because it provides date-accurate historical rates.
 * 2. ExchangeRate-API — live rates, 160+ currencies.
 *    Used when MAS doesn't support the currency.
 *    Note: free plan returns latest rate only (no historical).
 */
export async function resolveSgdRate(
  currencyCode: string,
  date: string
): Promise<RateResult | null> {
  const masResult = await getSgdRate(currencyCode, date);
  if (masResult !== null) return masResult;

  return getExchangeRateSgd(currencyCode, date);
}
