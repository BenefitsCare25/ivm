import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCookiesSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { toInputJson } from "@/lib/utils";
import { encrypt } from "@/lib/crypto";
import { deriveCookieExpiresAt } from "@/lib/cookie-expiry";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = saveCookiesSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!portal) throw new NotFoundError("Portal");

    // Honour the captured cookies' real lifetime (e.g. a "remember me" token) so a
    // long-lived session isn't dropped at a fixed 24h; falls back to 24h when only
    // session cookies are present.
    const expiresAt = parsed.data.expiresAt
      ? new Date(parsed.data.expiresAt)
      : deriveCookieExpiresAt(parsed.data.cookies);

    const encryptedCookies = toInputJson({ __encrypted: encrypt(JSON.stringify(parsed.data.cookies)) });

    await db.portalCredential.upsert({
      where: { portalId: id },
      create: {
        portalId: id,
        cookieData: encryptedCookies,
        cookieExpiresAt: expiresAt,
      },
      update: {
        cookieData: encryptedCookies,
        cookieExpiresAt: expiresAt,
      },
    });

    return NextResponse.json({ success: true, expiresAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
