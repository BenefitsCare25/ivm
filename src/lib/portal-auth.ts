import { ValidationError } from "@/lib/errors";

interface PortalCredentialCheck {
  cookieData: unknown;
  cookieExpiresAt: Date | null;
  encryptedUsername: string | null;
  encryptedPassword: string | null;
}

export function assertAuthValid(credential: PortalCredentialCheck | null): void {
  const hasCredentials = !!(credential?.encryptedUsername && credential?.encryptedPassword);
  const hasCookies = !!credential?.cookieData;
  const cookiesExpired = hasCookies && credential?.cookieExpiresAt && credential.cookieExpiresAt < new Date();

  if (!hasCredentials && !hasCookies) {
    throw new ValidationError("Authentication not configured. Set up cookies or credentials on the portal page before scraping.");
  }
  if (!hasCredentials && cookiesExpired) {
    throw new ValidationError("Portal cookies have expired. Update authentication on the portal page before scraping.");
  }
}
