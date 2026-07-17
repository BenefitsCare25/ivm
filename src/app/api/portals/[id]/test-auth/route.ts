import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { authenticateWithCredentials } from "@/lib/playwright/auth";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Test whether the stored login credentials actually authenticate against the
 * portal. Runs the exact credential login the scraper uses (fill form → submit),
 * then reports whether it reached an authenticated page or bounced back to the
 * login form (with the portal's error message when present). Does NOT persist
 * anything. Used by the "Test login" button in the auth panel.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      include: { credential: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const cred = portal.credential;
    if (!cred?.encryptedUsername || !cred?.encryptedPassword) {
      throw new ValidationError("No login credentials saved for this portal. Save a username and password first.");
    }

    let context: Awaited<ReturnType<typeof authenticateWithCredentials>>["context"] | null = null;
    try {
      const res = await authenticateWithCredentials({
        loginUrl: portal.baseUrl,
        encryptedUsername: cred.encryptedUsername,
        encryptedPassword: cred.encryptedPassword,
      });
      context = res.context;

      // Give the portal a moment to render its post-submit state (error toast or
      // the authenticated page).
      await res.page.waitForTimeout(2500);
      const landingUrl = res.page.url();
      const stillOnLogin = await res.page
        .evaluate(() => !!document.querySelector("input[type='password']"))
        .catch(() => false);
      const errorText = await res.page
        .evaluate(() => {
          const sel =
            "[class*='error'], [class*='alert'], [class*='invalid'], [role='alert'], .text-danger, .toast";
          return Array.from(document.querySelectorAll(sel))
            .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 3)
            .join(" ")
            .slice(0, 200);
        })
        .catch(() => "");

      const ok = !stillOnLogin;
      logger.info({ portalId: id, ok, landingUrl }, "[test-auth] Credential login test");

      return NextResponse.json({
        ok,
        message: ok
          ? "Login successful — credentials are valid."
          : errorText
            ? `Login rejected by portal: "${errorText}". Check the username and password.`
            : "Login failed — the page stayed on the login form. Check the username and password.",
        landingUrl,
      });
    } finally {
      if (context) await context.close();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
