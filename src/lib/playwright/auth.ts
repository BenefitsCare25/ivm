import { BrowserContext, Page, Cookie } from "playwright";
import { createBrowserContext } from "./browser";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

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

  const username = decrypt(options.encryptedUsername);
  const password = decrypt(options.encryptedPassword);

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
}): Promise<{ context: BrowserContext; page: Page }> {
  const cred = portal.credential;

  // Try cookies first
  if (cred?.cookieData) {
    const cookies = cred.cookieData as Cookie[];
    const expired = cred.cookieExpiresAt && new Date(cred.cookieExpiresAt) < new Date();

    if (!expired && cookies.length > 0) {
      logger.info("[playwright] Using cookie-based authentication");
      const context = await authenticateWithCookies({ cookies });
      const page = await context.newPage();
      const targetUrl = portal.listPageUrl ?? portal.baseUrl;
      await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
      return { context, page };
    }

    logger.warn("[playwright] Cookies expired, falling back to credentials");
  }

  // Fall back to credentials
  if (cred?.encryptedUsername && cred?.encryptedPassword) {
    logger.info("[playwright] Using credential-based authentication");
    return authenticateWithCredentials({
      loginUrl: portal.baseUrl,
      encryptedUsername: cred.encryptedUsername,
      encryptedPassword: cred.encryptedPassword,
    });
  }

  throw new Error("No authentication method available — provide cookies or credentials");
}
