import { Cookie } from "playwright";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encrypt } from "@/lib/crypto";
import { toInputJson } from "@/lib/utils";
import { authenticateWithCookies, isLoginPage, decodeCookieData } from "./auth";

/**
 * Portal session keep-alive.
 *
 * Cookie-based portal sessions die two ways: an *idle* timeout (the portal
 * invalidates the session after a period of no requests) or an *absolute*
 * lifetime (a fixed deadline regardless of activity). This sweep makes a
 * lightweight authenticated request to each cookie-auth portal on a timer:
 *   • it resets the portal's idle timer, and
 *   • it captures any refreshed cookies the portal returns and pushes IVM's
 *     `cookieExpiresAt` forward — so a still-valid session isn't prematurely
 *     declared "expired" by IVM's own 24h capture window.
 *
 * It cannot defeat an absolute session lifetime; in that case it detects the
 * death early (lands on the login page) and marks the cookies expired so the UI
 * and `resolveAuth` reflect reality. Non-fatal per portal.
 */

// How many portals to check at once (each opens a short-lived browser context).
const CONCURRENCY = 2;
// On a successful keep-alive, extend IVM's expiry window by this much. It must
// exceed the portal-detail UI's "Expiring soon" (warn) threshold of 24h
// (portal-detail-view.tsx: `expiry < now + 24h`) — otherwise a just-confirmed-
// alive session would still render as "Expiring soon". A confirmed-alive session
// re-checked every ~15 min justifies a comfortably longer window; if keep-alive
// stops entirely, the session naturally lapses to "expired" after this window.
const REFRESH_TTL_MS = 48 * 60 * 60 * 1000;

interface KeepAliveTarget {
  id: string;
  name: string;
  baseUrl: string;
  listPageUrl: string | null;
  cookies: Cookie[];
}

export interface KeepAliveSummary {
  checked: number;
  refreshed: number;
  expired: number;
}

export async function runPortalKeepAlive(): Promise<KeepAliveSummary> {
  const portals = await db.portal.findMany({
    where: { credential: { isNot: null } },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      listPageUrl: true,
      credential: { select: { cookieData: true } },
    },
  });

  const targets: KeepAliveTarget[] = [];
  for (const p of portals) {
    if (!p.credential?.cookieData) continue; // credential-only portals don't need pinging
    let cookies: Cookie[] = [];
    try {
      cookies = decodeCookieData(p.credential.cookieData);
    } catch {
      cookies = [];
    }
    if (cookies.length === 0) continue;
    targets.push({ id: p.id, name: p.name, baseUrl: p.baseUrl, listPageUrl: p.listPageUrl, cookies });
  }

  let refreshed = 0;
  let expired = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(keepAliveOne));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        if (r.value === "refreshed") refreshed++;
        else if (r.value === "expired") expired++;
      } else {
        logger.warn({ err: r.reason, portalId: batch[idx].id }, "[keepalive] Portal check failed (non-fatal)");
      }
    });
  }

  logger.info({ checked: targets.length, refreshed, expired }, "[keepalive] Portal keep-alive sweep complete");
  return { checked: targets.length, refreshed, expired };
}

async function keepAliveOne(target: KeepAliveTarget): Promise<"refreshed" | "expired"> {
  const targetUrl = target.listPageUrl ?? target.baseUrl;
  const context = await authenticateWithCookies({ cookies: target.cookies });
  try {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });

    // Only a genuine login page (URL pattern or password field) counts as dead —
    // a transient error page has no password input, so it's treated as alive and
    // left untouched. A network error throws and is caught upstream (no change).
    if (await isLoginPage(page, targetUrl)) {
      await db.portalCredential.update({
        where: { portalId: target.id },
        data: { cookieExpiresAt: new Date(Date.now() - 60_000) },
      });
      logger.warn({ portalId: target.id, portal: target.name }, "[keepalive] Session expired on portal — marked cookies expired");
      return "expired";
    }

    // Alive: persist the current (possibly refreshed) cookie set and extend the
    // expiry window. Skip the cookieData write if the context somehow reports no
    // cookies, so we never blank out a working credential.
    const fresh = await context.cookies();
    const data: { cookieExpiresAt: Date; cookieData?: ReturnType<typeof toInputJson> } = {
      cookieExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    };
    if (fresh.length > 0) {
      data.cookieData = toInputJson({ __encrypted: encrypt(JSON.stringify(fresh)) });
    }
    await db.portalCredential.update({ where: { portalId: target.id }, data });
    logger.info({ portalId: target.id, portal: target.name, cookieCount: fresh.length }, "[keepalive] Session alive — cookies refreshed");
    return "refreshed";
  } finally {
    await context.close();
  }
}
