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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(req);

  // Auth route rate limiting (register, credentials sign-in)
  if (pathname === "/api/auth/register" || pathname === "/api/auth/callback/credentials") {
    const result = authLimiter(ip);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many requests. Please try again later.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  // AI route rate limiting (per-user)
  if (/^\/api\/sessions\/[^/]+\/(extract|mapping)$/.test(pathname) && req.auth?.user?.id) {
    const result = aiLimiter(req.auth.user.id);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many AI requests. Please wait before retrying.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  // Global rate limiting for all API routes
  if (pathname.startsWith("/api/")) {
    const result = globalLimiter(ip);
    if (!result.allowed) {
      const res = rateLimitResponse(result, "Too many requests.");
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    }
  }

  // Auth redirects (existing logic)
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

  // Pass-through: set request ID on response + forward to route handler
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
});

export const config = {
  matcher: [
    "/((?!api/auth/(?!register)|api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};
