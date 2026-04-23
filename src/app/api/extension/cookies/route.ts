import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCookiesSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { authLimiter } from "@/lib/rate-limit";
import { toInputJson } from "@/lib/utils";
import { encrypt } from "@/lib/crypto";
import { verifyExtensionToken } from "@/lib/extension-token";

const extensionCookieSchema = z.object({
  url: z.string().url(),
  cookies: saveCookiesSchema.shape.cookies,
  /** HMAC-signed token issued by /api/auth/extension-token (replaces bare userId) */
  extensionToken: z.string().optional(),
});

/**
 * Receives cookies pushed from the Chrome Extension popup.
 * Matches the URL domain to an existing portal and saves the cookies.
 *
 * Auth: tries session cookie first (in-page requests). Falls back to a
 * HMAC-SHA256 signed extension token — never a bare userId.
 */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await authLimiter(ip);
    if (!rl.allowed) return new Response("Too Many Requests", { status: 429 });

    const session = await auth();
    let userId = session?.user?.id;

    const body = await req.json();
    const parsed = extensionCookieSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { url, cookies, extensionToken } = parsed.data;

    // Extension popup fallback: validate HMAC-signed token (not bare userId)
    if (!userId && extensionToken) {
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) throw new UnauthorizedError();
      const resolvedId = verifyExtensionToken(extensionToken, secret);
      if (!resolvedId) throw new UnauthorizedError();
      userId = resolvedId;
    }
    if (!userId) throw new UnauthorizedError();

    // Extract domain from the URL for matching
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      throw new ValidationError("Invalid URL");
    }

    // Find portals owned by the user whose baseUrl hostname matches exactly.
    // We match against both http and https variants to avoid false positives.
    const portals = await db.portal.findMany({
      where: {
        userId,
        OR: [
          { baseUrl: { startsWith: `https://${domain}/` } },
          { baseUrl: { startsWith: `http://${domain}/` } },
          { baseUrl: `https://${domain}` },
          { baseUrl: `http://${domain}` },
        ],
      },
      select: { id: true, name: true, baseUrl: true },
    });

    if (portals.length === 0) {
      throw new NotFoundError("Portal", domain);
    }

    const portal = portals[0];

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const encryptedCookies = toInputJson({ __encrypted: encrypt(JSON.stringify(cookies)) });

    await db.portalCredential.upsert({
      where: { portalId: portal.id },
      create: {
        portalId: portal.id,
        cookieData: encryptedCookies,
        cookieExpiresAt: expiresAt,
      },
      update: {
        cookieData: encryptedCookies,
        cookieExpiresAt: expiresAt,
      },
    });

    return NextResponse.json(
      { success: true, portalName: portal.name, portalId: portal.id, expiresAt },
      { status: 200 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
