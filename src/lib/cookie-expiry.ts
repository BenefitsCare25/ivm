/**
 * Derive how long IVM should treat freshly-captured cookies as usable, from the
 * cookies' own expiry rather than a fixed window.
 *
 * Why: `resolveAuth` treats `cookieExpiresAt < now` as expired and STOPS using
 * otherwise-valid cookies (falling back to credentials, which may not exist). A
 * hardcoded 24h therefore needlessly drops a long-lived "remember me" session at
 * 24h. Chrome/Playwright persistent cookies carry `expires` in SECONDS; session
 * cookies omit it (or use <= 0). We take the furthest-out persistent expiry (the
 * "remember me" token) so a long session is honoured, capped so a long-lived
 * tracking cookie can't feign months of validity. When only session cookies are
 * present we can't know the server-side lifetime, so fall back to 24h.
 *
 * This is only IVM's belief for gating/UI; `isLoginPage` still governs real
 * liveness at scrape/keep-alive time, so an over-long value degrades gracefully
 * (cookies are tried, detected dead, and the session is marked expired).
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — fallback for session-only cookies
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d cap

export interface CookieExpiryInput {
  expires?: number | null;
}

export function deriveCookieExpiresAt(
  cookies: CookieExpiryInput[],
  now: number = Date.now()
): Date {
  let maxMs = 0;
  for (const c of cookies) {
    const e = c.expires;
    if (typeof e === "number" && Number.isFinite(e) && e > 0) {
      const ms = e * 1000; // cookie expires are unix SECONDS
      if (ms > maxMs) maxMs = ms;
    }
  }
  // No persistent cookie (or all already elapsed) → unknown server lifetime → 24h.
  if (maxMs <= now) return new Date(now + DEFAULT_TTL_MS);
  // Honour the real expiry, capped at 30d.
  return new Date(Math.min(maxMs, now + MAX_TTL_MS));
}
