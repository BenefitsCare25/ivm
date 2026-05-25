import { logger } from "@/lib/logger";
import type { RateResult } from "./mas-rates";

const BASE_URL = "https://v6.exchangerate-api.com/v6";

const MAX_CACHE_ENTRIES = 60;

// In-memory cache keyed by date: "YYYY-MM-DD" → { rates, expiresAt }
const dateCache = new Map<string, { rates: Record<string, number>; expiresAt: number }>();

// Negative cache for dates where historical endpoint failed (403/error)
const failedHistorical = new Map<string, number>();
const FAILED_TTL = 3_600_000;

const today = (): string => new Date().toISOString().split("T")[0];

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of dateCache) {
    if (now >= entry.expiresAt) dateCache.delete(key);
  }
  for (const [key, expiresAt] of failedHistorical) {
    if (now >= expiresAt) failedHistorical.delete(key);
  }
}

function cacheSet(key: string, rates: Record<string, number>, expiresAt: number): void {
  if (dateCache.size >= MAX_CACHE_ENTRIES) evictExpired();
  if (dateCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = dateCache.keys().next().value as string;
    dateCache.delete(oldest);
  }
  dateCache.set(key, { rates, expiresAt });
}

function parseRatesFromResponse(json: Record<string, unknown>): Record<string, number> | null {
  if (json.result !== "success") {
    logger.warn({ result: json.result }, "[exchangerate-api] Non-success response");
    return null;
  }

  const conversionRates = json.conversion_rates as Record<string, number>;
  const sgdRates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(conversionRates)) {
    if (rate > 0) sgdRates[code] = 1 / rate;
  }
  sgdRates["SGD"] = 1;
  return sgdRates;
}

function extractResponseDate(json: Record<string, unknown>): string | null {
  const y = json.year as number | undefined;
  const m = json.month as number | undefined;
  const d = json.day as number | undefined;
  if (y && m && d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

async function fetchHistoricalRates(date: string): Promise<{ rates: Record<string, number>; responseDate: string } | null> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();

  // Check negative cache
  const failedUntil = failedHistorical.get(date);
  if (failedUntil && now < failedUntil) return null;

  const cached = dateCache.get(date);
  if (cached && now < cached.expiresAt) return { rates: cached.rates, responseDate: date };

  const [year, month, day] = date.split("-");
  const url = `${BASE_URL}/${apiKey}/history/SGD/${year}/${parseInt(month)}/${parseInt(day)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, date }, "[exchangerate-api] Historical API error — falling back to latest");
      failedHistorical.set(date, now + FAILED_TTL);
      return null;
    }

    const json = await res.json();
    const rates = parseRatesFromResponse(json);
    if (!rates) return null;

    const responseDate = extractResponseDate(json) ?? date;
    cacheSet(date, rates, now + 3_600_000);
    logger.debug({ currencies: Object.keys(rates).length, date, responseDate }, "[exchangerate-api] Historical rates cached");
    return { rates, responseDate };
  } catch (err) {
    logger.warn({ err, date }, "[exchangerate-api] Historical fetch failed — falling back to latest");
    failedHistorical.set(date, now + FAILED_TTL);
    return null;
  }
}

async function fetchLatestRates(): Promise<Record<string, number> | null> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();
  const todayStr = today();
  const cached = dateCache.get(todayStr);
  if (cached && now < cached.expiresAt) return cached.rates;

  try {
    const res = await fetch(`${BASE_URL}/${apiKey}/latest/SGD`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "[exchangerate-api] Latest API error");
      return null;
    }

    const json = await res.json();
    const rates = parseRatesFromResponse(json);
    if (rates) {
      cacheSet(todayStr, rates, now + 3_600_000);
      logger.debug({ currencies: Object.keys(rates).length }, "[exchangerate-api] Latest rates cached");
    }
    return rates;
  } catch (err) {
    logger.warn({ err }, "[exchangerate-api] Latest fetch failed");
    return null;
  }
}

/**
 * Returns the SGD rate for a currency using ExchangeRate-API.
 * Tries historical endpoint first (date-accurate), falls back to latest if
 * the plan doesn't support history or the request fails.
 */
export async function getExchangeRateSgd(
  currencyCode: string,
  requestedDate: string
): Promise<RateResult | null> {
  const code = currencyCode.toUpperCase();
  const todayStr = today();
  const isFuture = requestedDate > todayStr;
  const queryDate = isFuture ? todayStr : requestedDate;

  // Try historical first, fall back to latest
  const historical = await fetchHistoricalRates(queryDate);
  const rates = historical?.rates ?? await fetchLatestRates();
  if (!rates) return null;

  const rate = rates[code];
  if (!rate) {
    logger.debug({ currency: code }, "[exchangerate-api] Currency not found");
    return null;
  }

  const isHistorical = historical !== null;
  const actualDate = isHistorical ? historical.responseDate : todayStr;

  logger.debug(
    { currency: code, rate, requestedDate, actualDate, isHistorical, isFuture },
    "[exchangerate-api] Rate resolved"
  );

  return {
    rate,
    actualDate,
    isFallback: actualDate !== requestedDate,
    isFuture,
    isHistorical,
    source: "exchangerate-api",
  };
}
