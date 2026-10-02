import type { Page } from "playwright";
import { isLoginPage } from "@/lib/playwright/auth";
import { PortalDetailDestinationMismatchError } from "@/lib/playwright/scraper";

/** Check navigation failures for a genuine expired portal session. */
export async function getDetailAuthExpiryMessage(
  error: unknown,
  page: Page | undefined,
  authCheckUrl: string | undefined,
): Promise<string | null> {
  const message = error instanceof Error ? error.message : "Unknown error";
  // A redirected Inspro claim now fails its destination assertion before field
  // extraction. Probe that typed error too, but require login/logout evidence
  // before classifying it as expired auth: a stale claim alone is not expiry.
  const navigationFailure = error instanceof PortalDetailDestinationMismatchError ||
    /ERR_ABORTED|net::ERR|page\.goto|Claim detail page did not load correctly/i.test(message);
  if (
    !page || page.isClosed() || !authCheckUrl ||
    !navigationFailure
  ) return null;

  try {
    // An aborted navigation may leave the last authenticated page visible.
    // Re-probe a known portal URL only when the current page is not login/logout.
    let loginDetected = await isLoginPage(page);
    if (!loginDetected) {
      await page.goto(authCheckUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      loginDetected = await isLoginPage(page);
    }
    if (loginDetected) {
      return "Portal session expired — the portal redirected to login. Update cookies on the portal page and retry.";
    }
  } catch {
    // Best-effort evidence: a failed probe must not replace the original error.
  }
  return null;
}
