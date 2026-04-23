import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { globalLimiter, authLimiter, aiLimiter } from "@/lib/rate-limit";
import { REQUEST_ID_HEADER } from "@/lib/request-context";

// RFC 1918 + loopback — never trust these as real IPs (spoofable proxy hops)
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fc|fd)/;

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // Use the rightmost non-private IP — leftmost is attacker-controlled when
    // multiple proxies are in the chain. nginx/Traefik append the real IP last.
    const ips = forwarded.split(",").map((s) => s.trim()).reverse();
    const real = ips.find((ip) => !PRIVATE_IP_RE.test(ip));
    if (real) return real;
  }
  return "unknown";
}

function rateLimitResponse(result: { limit: number; resetAt: number }, message: string) {
  return NextResponse.json(
    { error: message, code: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function isAdminAllowedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/portals") ||
    pathname.startsWith("/api/portals") ||
    pathname.startsWith("/sign-out")
  );
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const ip = getClientIp(req);

  if (pathname === "/api/auth/register" || pathname === "/api/auth/callback/credentials") {
    const result = await authLimiter(ip);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many requests. Please try again later.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  if (
    req.auth?.user?.id && (
      /^\/api\/sessions\/[^/]+\/(extract|mapping)$/.test(pathname) ||
      /^\/api\/portals\/[^/]+\/analyze$/.test(pathname) ||
      /^\/api\/portals\/[^/]+\/scrape\/[^/]+\/recompare$/.test(pathname)
    )
  ) {
    const result = await aiLimiter(`user:${req.auth.user.id}`);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many AI requests. Please wait before retrying.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  if (pathname.startsWith("/api/")) {
    const globalKey = req.auth?.user?.id ? `user:${req.auth.user.id}` : ip;
    const result = await globalLimiter(globalKey);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many requests.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  const isAuthenticated = !!req.auth;
  const role = req.auth?.user?.role;
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (isAuthPage) {
    if (isAuthenticated) {
      const redirectPath = role === "ADMIN" ? "/portals" : "/";
      return Response.redirect(new URL(redirectPath, req.url));
    }
    return;
  }

  if (!isAuthenticated) {
    return Response.redirect(new URL("/sign-in", req.url));
  }

  // Role-based access control: Admin users can only access portal routes
  if (role === "ADMIN") {
    if (pathname.startsWith("/api/")) {
      if (!isAdminAllowedPath(pathname)) {
        return NextResponse.json(
          { error: "Forbidden", code: "FORBIDDEN" },
          { status: 403 }
        );
      }
    } else if (!isAdminAllowedPath(pathname)) {
      return Response.redirect(new URL("/portals", req.url));
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
});

export const config = {
  matcher: [
    // Exclude NextAuth internals but keep /api/auth/register and /api/auth/callback/credentials
    // so authLimiter applies to both login and registration endpoints.
    "/((?!api/auth/(?!register|callback/credentials)|api/health|api/metrics|api/extension/cookies|docs|_next/static|_next/image|favicon.ico|openapi.yaml).*)",
  ],
};
