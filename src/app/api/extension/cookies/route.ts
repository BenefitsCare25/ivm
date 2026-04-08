import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCookiesSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

const extensionCookieSchema = z.object({
  url: z.string().url(),
  cookies: saveCookiesSchema.shape.cookies,
});

/**
 * Receives cookies pushed from the Chrome Extension popup.
 * Matches the URL domain to an existing portal and saves the cookies.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = extensionCookieSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { url, cookies } = parsed.data;

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
        userId: session.user.id,
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
        cookieData: JSON.parse(JSON.stringify(cookies)),
        cookieExpiresAt: expiresAt,
      },
      update: {
        cookieData: JSON.parse(JSON.stringify(cookies)),
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
