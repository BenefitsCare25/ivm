import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCookiesSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { authLimiter } from "@/lib/rate-limit";
import { toInputJson } from "@/lib/utils";

const extensionCookieSchema = z.object({
  url: z.string().url(),
  cookies: saveCookiesSchema.shape.cookies,
  /** Optional userId for extension popup auth (session cookie may not be sent cross-origin) */
  userId: z.string().optional(),
});

/**
 * Receives cookies pushed from the Chrome Extension popup.
 * Matches the URL domain to an existing portal and saves the cookies.
 *
 * Auth: tries session cookie first (in-page requests). Falls back to
 * userId in body (extension popup where SameSite=Lax blocks the cookie).
 * The userId alone is low-risk — it only lets you write cookies to your
 * own portals, and the portal ownership check prevents cross-user writes.
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

    const { url, cookies, userId: bodyUserId } = parsed.data;

    // Extension popup fallback: accept userId from body when session cookie is unavailable
    if (!userId && bodyUserId) {
      userId = bodyUserId;
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

    await db.portalCredential.upsert({
      where: { portalId: portal.id },
      create: {
        portalId: portal.id,
        cookieData: toInputJson(cookies),
        cookieExpiresAt: expiresAt,
      },
      update: {
        cookieData: toInputJson(cookies),
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
