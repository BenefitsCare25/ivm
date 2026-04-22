import { logger } from "@/lib/logger";
import type { RateResult } from "./mas-rates";

const BASE_URL = "https://v6.exchangerate-api.com/v6";

// In-memory cache: SGD-per-unit for every currency, expires after 1 hour
let cache: { rates: Record<string, number>; fetchedAt: string; expiresAt: number } | null = null;

const today = (): string => new Date().toISOString().split("T")[0];

async function fetchLatestRates(): Promise<Record<string, number> | null> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.rates;

  try {
    const res = await fetch(`${BASE_URL}/${apiKey}/latest/SGD`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "[exchangerate-api] API error");
      return null;
    }
    const json = await res.json();
    if (json.result !== "success") {
      logger.warn({ result: json.result }, "[exchangerate-api] Non-success response");
      return null;
    }

    // json.conversion_rates maps SGD → X, so X → SGD = 1 / rate
    const conversionRates = json.conversion_rates as Record<string, number>;
    const sgdRates: Record<string, number> = {};
    for (const [code, rate] of Object.entries(conversionRates)) {
      if (rate > 0) sgdRates[code] = 1 / rate;
    }
    sgdRates["SGD"] = 1;

    cache = { rates: sgdRates, fetchedAt: today(), expiresAt: now + 3_600_000 };
    logger.debug({ currencies: Object.keys(sgdRates).length }, "[exchangerate-api] Rates cached");
    return sgdRates;
  } catch (err) {
    logger.warn({ err }, "[exchangerate-api] Fetch failed");
    return null;
  }
}

/**
 * Returns the SGD rate for a currency using ExchangeRate-API live data.
 * Always returns today's rate — no historical data on free plan.
 */
export async function getExchangeRateSgd(
  currencyCode: string,
  requestedDate: string
): Promise<RateResult | null> {
  const code = currencyCode.toUpperCase();
  const rates = await fetchLatestRates();
  if (!rates) return null;

  const rate = rates[code];
  if (!rate) {
    logger.debug({ currency: code }, "[exchangerate-api] Currency not found");
    return null;
  }

  const actualDate = cache?.fetchedAt ?? today();
  const isFuture = requestedDate > today();

  logger.debug({ currency: code, rate, requestedDate, actualDate, isFuture }, "[exchangerate-api] Rate resolved");

  return {
    rate,
    actualDate,
    // ExchangeRate-API only has live rates — always a fallback if date ≠ today
    isFallback: requestedDate !== actualDate,
    isFuture,
    source: "exchangerate-api",
  };
}
