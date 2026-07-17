import { BrowserContext, Cookie } from "playwright";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encrypt } from "@/lib/crypto";
import { toInputJson } from "@/lib/utils";
import {
  authenticateWithCookies,
  authenticateWithCredentials,
  isLoginPage,
  decodeCookieData,
} from "./auth";

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
 * If the session is dead (lands on a login/logout page) the sweep self-heals
 * when the portal has stored credentials: it re-logs in, captures fresh cookies
 * and persists them. Without credentials it can only mark the cookies expired so
 * the UI and `resolveAuth` reflect reality (re-capture required). Non-fatal per
 * portal.
 *
 * NOTE: on single-session portals (one active session per login, e.g. Inspro)
 * this sweep contends with a human using the same account and will evict them —
 * disable it (`PORTAL_KEEPALIVE_MINUTES=off`) or give IVM a dedicated login.
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
  encryptedUsername: string | null;
  encryptedPassword: string | null;
}

type KeepAliveOutcome = "refreshed" | "relogin" | "expired";

export interface KeepAliveSummary {
  checked: number;
  refreshed: number;
  /** Sessions that were dead but re-established via credential login. */
  reloggedIn: number;
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
      credential: {
        select: {
          cookieData: true,
          encryptedUsername: true,
          encryptedPassword: true,
        },
      },
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
    targets.push({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      listPageUrl: p.listPageUrl,
      cookies,
      encryptedUsername: p.credential.encryptedUsername,
      encryptedPassword: p.credential.encryptedPassword,
    });
  }

  let refreshed = 0;
  let reloggedIn = 0;
  let expired = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(keepAliveOne));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        if (r.value === "refreshed") refreshed++;
        else if (r.value === "relogin") reloggedIn++;
        else if (r.value === "expired") expired++;
      } else {
        logger.warn({ err: r.reason, portalId: batch[idx].id }, "[keepalive] Portal check failed (non-fatal)");
      }
    });
  }

  logger.info({ checked: targets.length, refreshed, reloggedIn, expired }, "[keepalive] Portal keep-alive sweep complete");
  return { checked: targets.length, refreshed, reloggedIn, expired };
}

async function keepAliveOne(target: KeepAliveTarget): Promise<KeepAliveOutcome> {
  const targetUrl = target.listPageUrl ?? target.baseUrl;

  // 1) Ping with the stored cookies to check liveness (and capture rotations).
  const cookieContext = await authenticateWithCookies({ cookies: target.cookies });
  let sessionAlive = false;
  let freshCookies: Cookie[] = [];
  try {
    const page = await cookieContext.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
    // A genuine login/logout page (URL pattern, password field, or logged-out
    // interstitial) means the session is dead; anything else is treated as alive.
    sessionAlive = !(await isLoginPage(page, targetUrl));
    if (sessionAlive) freshCookies = await cookieContext.cookies();
  } finally {
    await cookieContext.close();
  }

  if (sessionAlive) {
    await persistAlive(target, freshCookies);
    logger.info(
      { portalId: target.id, portal: target.name, cookieCount: freshCookies.length },
      "[keepalive] Session alive — cookies refreshed"
    );
    return "refreshed";
  }

  // 2) Session dead — self-heal via credential re-login when credentials exist.
  if (target.encryptedUsername && target.encryptedPassword) {
    const healed = await tryCredentialRelogin(target, targetUrl);
    if (healed && healed.length > 0) {
      await persistAlive(target, healed);
      logger.info(
        { portalId: target.id, portal: target.name, cookieCount: healed.length },
        "[keepalive] Session re-established via credential login"
      );
      return "relogin";
    }
    logger.warn(
      { portalId: target.id, portal: target.name },
      "[keepalive] Credential re-login failed — marking cookies expired"
    );
  }

  // 3) No credentials or re-login failed — mark expired so the UI/resolveAuth
  //    reflect reality (cookies must be re-captured).
  await db.portalCredential.update({
    where: { portalId: target.id },
    data: { cookieExpiresAt: new Date(Date.now() - 60_000) },
  });
  logger.warn(
    { portalId: target.id, portal: target.name },
    "[keepalive] Session expired on portal — marked cookies expired"
  );
  return "expired";
}

/** Persist a live/refreshed cookie set and extend the expiry window. Skips the
 *  cookieData write if the set is empty so a working credential is never blanked. */
async function persistAlive(target: KeepAliveTarget, cookies: Cookie[]): Promise<void> {
  const data: { cookieExpiresAt: Date; cookieData?: ReturnType<typeof toInputJson> } = {
    cookieExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  };
  if (cookies.length > 0) {
    data.cookieData = toInputJson({ __encrypted: encrypt(JSON.stringify(cookies)) });
  }
  await db.portalCredential.update({ where: { portalId: target.id }, data });
}

/**
 * Re-establish a dead session via credential login and return the fresh cookies.
 * Best-effort: never throws, returns null on any failure (bad/absent creds,
 * changed login form, still-on-login after submit). Mirrors `resolveAuth`'s
 * credential fallback (loginUrl = baseUrl, default form selectors).
 */
async function tryCredentialRelogin(
  target: KeepAliveTarget,
  targetUrl: string
): Promise<Cookie[] | null> {
  if (!target.encryptedUsername || !target.encryptedPassword) return null;
  let context: BrowserContext | null = null;
  try {
    const res = await authenticateWithCredentials({
      loginUrl: target.baseUrl,
      encryptedUsername: target.encryptedUsername,
      encryptedPassword: target.encryptedPassword,
    });
    context = res.context;
    // Confirm the login actually took by loading the target page.
    await res.page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
    if (await isLoginPage(res.page, targetUrl)) return null;
    return await context.cookies();
  } catch (err) {
    logger.warn({ err, portalId: target.id }, "[keepalive] Credential re-login threw (non-fatal)");
    return null;
  } finally {
    if (context) await context.close();
  }
}
