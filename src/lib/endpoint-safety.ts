import { ValidationError } from "@/lib/errors";

/**
 * Guard against SSRF via user-supplied AI endpoints (azure-foundry / local).
 *
 * The server fetches these URLs at validation time and on every extraction, so a
 * malicious endpoint could reach internal services. We block cloud metadata and
 * link-local ranges (the high-value targets on a cloud VM) while intentionally
 * ALLOWING loopback and private ranges — self-hosted models legitimately live on
 * localhost, LAN IPs, and Tailscale's 100.64.0.0/10 CGNAT range.
 *
 * Note: this checks the literal host in the URL. DNS-rebinding (a hostname that
 * resolves to a blocked IP) is out of scope for this BYOK, per-user surface.
 */
export function assertSafeEndpoint(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError("Endpoint must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Endpoint must use http or https.");
  }

  // Strip IPv6 brackets, lowercase for comparison.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Cloud metadata hostnames (GCP/GKE resolve to 169.254.169.254).
  if (host === "metadata.google.internal" || host === "metadata.goog") {
    throw new ValidationError("This endpoint address is not allowed.");
  }

  // IPv4 link-local / cloud metadata: 169.254.0.0/16 (covers AWS/Azure/GCP 169.254.169.254).
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
    throw new ValidationError("Link-local / metadata addresses are not allowed.");
  }

  // IPv6 link-local (fe80::/10) and the AWS IMDS unique-local address.
  if (host.startsWith("fe80:") || host === "fd00:ec2::254") {
    throw new ValidationError("Link-local / metadata addresses are not allowed.");
  }
}
