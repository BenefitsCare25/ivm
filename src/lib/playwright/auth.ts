import { BrowserContext, Page, Cookie } from "playwright";
import { createBrowserContext } from "./browser";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { toInputJson } from "@/lib/utils";
import { logger } from "@/lib/logger";

// Window applied to cookies captured by an automatic credential re-login. Keeps
// it modest — the keep-alive sweep extends it further when it confirms liveness.
const RELOGIN_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Persist the freshly-authenticated session cookies back onto the portal
 * credential so subsequent items/runs use fast cookie auth instead of logging in
 * again. Best-effort — a failure here never blocks the scrape. No-op without a
 * portalId (one-off callers like analyze/discovery don't need persistence).
 */
async function persistFreshCookies(portalId: string | undefined, context: BrowserContext): Promise<void> {
  if (!portalId) return;
  try {
    const cookies = await context.cookies();
    if (cookies.length === 0) return;
    await db.portalCredential.update({
      where: { portalId },
      data: {
        cookieData: toInputJson({ __encrypted: encrypt(JSON.stringify(cookies)) }),
        cookieExpiresAt: new Date(Date.now() + RELOGIN_COOKIE_TTL_MS),
      },
    });
    logger.info({ portalId, cookieCount: cookies.length }, "[playwright] Persisted fresh cookies after credential login");
  } catch (err) {
    logger.warn({ err, portalId }, "[playwright] Failed to persist cookies after credential login (non-fatal)");
  }
}

/**
 * Decrypts cookieData stored by the portal credential routes.
 * Supports both the encrypted sentinel format `{ __encrypted: "..." }` and
 * legacy plaintext arrays written before encryption was introduced.
 */
export function decodeCookieData(raw: unknown): Cookie[] {
  if (!raw) return [];
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.__encrypted === "string") {
      return JSON.parse(decrypt(obj.__encrypted)) as Cookie[];
    }
  }
  // Legacy: raw array stored without encryption
  return raw as Cookie[];
}

interface CookieAuthOptions {
  cookies: Cookie[];
}

interface CredentialAuthOptions {
  loginUrl: string;
  encryptedUsername: string;
  encryptedPassword: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  onPageCreated?: (page: Page) => void;
}

interface ResolveAuthOptions {
  onPageCreated?: (page: Page) => void;
}

/**
 * Creates a browser context with pre-injected cookies from the Chrome Extension.
 */
export async function authenticateWithCookies(
  options: CookieAuthOptions
): Promise<BrowserContext> {
  return createBrowserContext({ cookies: options.cookies });
}

/**
 * Creates a browser context and logs in via credential entry.
 * Uses provided selectors or falls back to common login form patterns.
 */
export async function authenticateWithCredentials(
  options: CredentialAuthOptions
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await createBrowserContext();
  const page = await context.newPage();
  options.onPageCreated?.(page);

  let username: string;
  let password: string;
  try {
    username = decrypt(options.encryptedUsername);
    password = decrypt(options.encryptedPassword);
  } catch {
    await context.close();
    throw new Error("Failed to decrypt credentials — re-configure authentication in portal settings");
  }

  logger.info({ loginUrl: options.loginUrl }, "[playwright] Navigating to login page");

  await page.goto(options.loginUrl, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  const usernameSelector = options.usernameSelector
    ?? 'input[type="email"], input[type="text"][name*="user"], input[name*="email"], input[id*="user"], input[id*="email"], input[type="text"]:first-of-type';
  const passwordSelector = options.passwordSelector
    ?? 'input[type="password"]';
  const submitSelector = options.submitSelector
    ?? 'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Login")';

  const usernameInput = await page.waitForSelector(usernameSelector, { timeout: 10_000 });
  if (!usernameInput) throw new Error("Could not find username input");

  await usernameInput.fill(username);

  const passwordInput = await page.waitForSelector(passwordSelector, { timeout: 10_000 });
  if (!passwordInput) throw new Error("Could not find password input");

  await passwordInput.fill(password);

  const submitButton = await page.waitForSelector(submitSelector, { timeout: 10_000 });
  if (!submitButton) throw new Error("Could not find submit button");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => {}),
    submitButton.click(),
  ]);

  logger.info({ url: page.url() }, "[playwright] Login completed, landed on page");

  return { context, page };
}

const LOGIN_URL_PATTERNS = [/\/login/i, /\/signin/i, /\/sign-in/i, /\/auth/i, /\/sso/i, /\/account\/login/i];
// A dead session frequently redirects to a LOGOUT / session-ended interstitial
// (e.g. Inspro lands on `/admin/logout` → "You have logged out successfully",
// which has NO password field and no "login" in the URL). These pages are an
// unauthenticated state and must be treated exactly like a login page, otherwise
// keep-alive/resolveAuth read a dead session as still valid.
const LOGOUT_URL_PATTERNS = [
  /\/logout/i, /\/logoff/i, /\/signout/i, /\/sign-out/i,
  /\/logged-?out/i, /session[-_]?expired/i, /session[-_]?timeout/i,
];
// Body-text markers of an ended/expired session, for logout pages whose URL isn't
// obviously a logout route. Checked only on SHORT pages so a data-heavy
// authenticated page (which may carry a "Logout" nav link) is never misread.
const LOGGED_OUT_TEXT =
  /you have (been )?logged out|logged out successfully|log(ged)?\s*off|session (has )?(expired|ended|timed out)|back to login|please (log|sign)\s*in( again)?|sign in to continue/i;
const MAX_INTERSTITIAL_TEXT = 2000;

export async function isLoginPage(page: Page, expectedUrl?: string): Promise<boolean> {
  const currentUrl = page.url();
  if (LOGIN_URL_PATTERNS.some((p) => p.test(currentUrl))) return true;
  if (LOGOUT_URL_PATTERNS.some((p) => p.test(currentUrl))) return true;

  const hasPasswordInput = await page.$('input[type="password"]').then((el) => !!el).catch(() => false);
  if (hasPasswordInput) {
    if (expectedUrl) {
      const expectedPath = new URL(expectedUrl).pathname;
      const currentPath = new URL(currentUrl).pathname;
      return currentPath !== expectedPath;
    }
    return true;
  }

  // No password field and not an obvious login/logout URL — catch an explicit
  // "logged out / session expired" interstitial by its text, bounded to short
  // pages so authenticated content is never falsely flagged.
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  if (bodyText.length <= MAX_INTERSTITIAL_TEXT && LOGGED_OUT_TEXT.test(bodyText)) return true;

  return false;
}

/**
 * Resolves authentication strategy based on portal credential state.
 * Prefers cookies if available and not expired; falls back to credentials.
 */
export async function resolveAuth(portal: {
  credential: {
    cookieData: unknown;
    cookieExpiresAt: Date | null;
    encryptedUsername: string | null;
    encryptedPassword: string | null;
  } | null;
  baseUrl: string;
  listPageUrl: string | null;
  /** When set, cookies from an automatic credential re-login are persisted back
   *  onto this portal so the rest of the run uses fast cookie auth. */
  portalId?: string;
}, options: ResolveAuthOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const cred = portal.credential;

  // Try cookies first
  if (cred?.cookieData) {
    const cookies = decodeCookieData(cred.cookieData);
    const expired = cred.cookieExpiresAt && new Date(cred.cookieExpiresAt) < new Date();

    if (!expired && cookies.length > 0) {
      logger.info("[playwright] Using cookie-based authentication");
      const context = await authenticateWithCookies({ cookies });
      const page = await context.newPage();
      options.onPageCreated?.(page);
      const targetUrl = portal.listPageUrl ?? portal.baseUrl;
      await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });

      const loginDetected = await isLoginPage(page, targetUrl);
      if (loginDetected) {
        logger.warn({ finalUrl: page.url() }, "[playwright] Cookie auth landed on login page — session likely expired");
        await context.close();
        // Fall through to credential auth if available
      } else {
        return { context, page };
      }
    } else {
      logger.warn("[playwright] Cookies expired, falling back to credentials");
    }
  }

  // Fall back to credentials. This is the mid-run self-heal: when the cookie
  // session dies during a scrape, the next item lands here, logs in again, and
  // the run continues instead of breaking. Fresh cookies are persisted so only
  // the first post-expiry item pays the full-login cost.
  if (cred?.encryptedUsername && cred?.encryptedPassword) {
    logger.info("[playwright] Using credential-based authentication");
    const result = await authenticateWithCredentials({
      loginUrl: portal.baseUrl,
      encryptedUsername: cred.encryptedUsername,
      encryptedPassword: cred.encryptedPassword,
      onPageCreated: options.onPageCreated,
    });
    await persistFreshCookies(portal.portalId, result.context);
    return result;
  }

  throw new Error("No authentication method available — provide cookies or credentials");
}
