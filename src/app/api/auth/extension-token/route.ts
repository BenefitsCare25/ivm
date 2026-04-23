import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { errorResponse, UnauthorizedError, AppError } from "@/lib/errors";

const TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateExtensionToken(userId: string, secret: string): string {
  const expiresAt = Date.now() + TOKEN_VALIDITY_MS;
  const payload = `${userId}:${expiresAt}`;
  const hmac = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${hmac}`).toString("base64url");
}

export function verifyExtensionToken(token: string, secret: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":", decoded.lastIndexOf(":") - 1);
    const hmacPart = decoded.slice(decoded.lastIndexOf(":") + 1);
    const rest = decoded.slice(0, decoded.lastIndexOf(":"));
    const secondLastColon = rest.lastIndexOf(":");
    const expiresAtStr = rest.slice(secondLastColon + 1);
    const userId = rest.slice(0, secondLastColon);

    if (!userId || !expiresAtStr || !hmacPart) return null;

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return null;

    const payload = `${userId}:${expiresAt}`;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");

    const hmacBuf = Buffer.from(hmacPart, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (hmacBuf.length !== expectedBuf.length) return null;

    return timingSafeEqual(hmacBuf, expectedBuf) ? userId : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new AppError("Server configuration error", 500, "CONFIG_ERROR");

    const token = generateExtensionToken(session.user.id, secret);
    return NextResponse.json({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
