import { createHmac, timingSafeEqual } from "crypto";

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
    const parts = decoded.split(":");
    if (parts.length < 3) return null;

    const hmacPart = parts.pop()!;
    const expiresAtStr = parts.pop()!;
    const userId = parts.join(":");

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
