import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { globalLimiter, authLimiter, aiLimiter } from "@/lib/rate-limit";
import { REQUEST_ID_HEADER } from "@/lib/request-context";

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
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
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
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

  if (/^\/api\/sessions\/[^/]+\/(extract|mapping)$/.test(pathname) && req.auth?.user?.id) {
    const result = await aiLimiter(req.auth.user.id);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many AI requests. Please wait before retrying.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  if (pathname.startsWith("/api/")) {
    const result = await globalLimiter(ip);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many requests.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  const isAuthenticated = !!req.auth;
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (isAuthPage) {
    if (isAuthenticated) {
      return Response.redirect(new URL("/", req.url));
    }
    return;
  }

  if (!isAuthenticated) {
    return Response.redirect(new URL("/sign-in", req.url));
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
    "/((?!api/auth/(?!register)|api/health|api/metrics|_next/static|_next/image|favicon.ico).*)",
  ],
};
