# Phase 7: Production Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden IVM for production with security headers, rate limiting, health checks, environment validation, AI call resilience (timeouts + retries), request ID tracing, error boundaries, and graceful shutdown.

**Architecture:** Backend/infrastructure changes only. No schema changes. No new npm dependencies — everything built with Node.js builtins, Zod (installed), and Pino (installed). Middleware grows to handle request IDs and rate limiting. AI call wrappers gain timeout and retry capabilities.

**Tech Stack:** Next.js 15 App Router, Pino logger, Zod validation, Node.js crypto

---

## File Structure

### New Files (7)

| File | Responsibility |
|------|---------------|
| `src/lib/env.ts` | Zod schema validating required env vars at import time; exports typed `env` |
| `src/lib/rate-limit.ts` | In-memory sliding-window rate limiter factory |
| `src/lib/retry.ts` | Generic `withRetry(fn, opts)` with exponential backoff |
| `src/lib/request-context.ts` | Request ID header constant + getter helper |
| `src/app/api/health/route.ts` | GET health check — DB ping, uptime |
| `src/app/error.tsx` | Root error boundary |
| `src/app/(dashboard)/error.tsx` | Dashboard error boundary |

### Modified Files (11)

| File | Change |
|------|--------|
| `next.config.ts` | Add `headers()` with CSP, HSTS, X-Frame-Options, etc. |
| `middleware.ts` | Add request ID generation, rate limiting, log request |
| `src/lib/logger.ts` | Add `createRequestLogger()` helper |
| `src/lib/db.ts` | Import `env.ts` for startup validation; add graceful shutdown |
| `src/lib/ai/anthropic.ts` | Add 60s AbortSignal timeout |
| `src/lib/ai/openai.ts` | Add 60s AbortSignal timeout |
| `src/lib/ai/gemini.ts` | Add 60s timeout via Promise.race |
| `src/lib/ai/mapping.ts` | Add 30s timeouts + wrap calls with `withRetry()` |
| `src/lib/ai/index.ts` | Wrap `extractFieldsFromDocument` with `withRetry()` |
| `src/lib/ai/validate-key.ts` | Add 15s timeouts to all validation calls |
| `prisma/seed.ts` | Add production guard |

---

## Task 1: Environment Validation

**Files:**
- Create: `src/lib/env.ts`
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Create `src/lib/env.ts`**

```typescript
// src/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY must be a 64-char hex string"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./uploads"),
  AI_PROVIDER: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  FEATURE_BROWSER_WORKSPACE: z.string().optional(),
  FEATURE_PDF_FILL: z.string().optional(),
  FEATURE_DOCX_FILL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n[ENV VALIDATION FAILED]\n${formatted}\n`);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
```

- [ ] **Step 2: Wire env validation into app startup**

Add `import "@/lib/env";` as the first line of `src/lib/db.ts` (before the PrismaClient import). Since `db.ts` is imported by nearly every API route and by `auth.ts`, this ensures env validation runs early.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts src/lib/db.ts
git commit -m "feat: add env validation with Zod"
```

---

## Task 2: Security Headers

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Add `headers()` config to `next.config.ts`**

Replace the entire file:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

Note: CSP allows `unsafe-inline`/`unsafe-eval` for `script-src` because Next.js injects inline scripts. A future nonce-based CSP enhancement can tighten this.

- [ ] **Step 2: Commit**

```bash
git add next.config.ts
git commit -m "feat: add security headers"
```

---

## Task 3: Rate Limiting

**Files:**
- Create: `src/lib/rate-limit.ts`

- [ ] **Step 1: Create `src/lib/rate-limit.ts`**

```typescript
// src/lib/rate-limit.ts

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);

  if (cleanupInterval.unref) cleanupInterval.unref();

  return function check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + config.windowMs });
      return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt: now + config.windowMs };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= config.limit,
      limit: config.limit,
      remaining: Math.max(0, config.limit - entry.count),
      resetAt: entry.resetAt,
    };
  };
}

/** 100 req/min per IP for all API routes */
export const globalLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 });

/** 10 req/min per IP for auth routes (login, register) */
export const authLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** 5 req/min per user for AI routes (extract, mapping) */
export const aiLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat: add in-memory rate limiter"
```

---

## Task 4: Request ID + Middleware Rewrite

**Files:**
- Create: `src/lib/request-context.ts`
- Modify: `src/lib/logger.ts`
- Modify: `middleware.ts`

- [ ] **Step 1: Create `src/lib/request-context.ts`**

```typescript
// src/lib/request-context.ts
export const REQUEST_ID_HEADER = "x-request-id";
```

- [ ] **Step 2: Add `createRequestLogger` to `src/lib/logger.ts`**

Replace the full file:

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
```

- [ ] **Step 3: Rewrite `middleware.ts` with rate limiting + request ID**

Replace the entire file. Key changes:
- Generate `X-Request-ID` via `crypto.randomUUID()`
- Apply auth, AI, and global rate limiters
- Forward request ID header to route handlers
- Exclude `/api/health` from auth (for monitoring)
- Keep existing auth redirect logic

```typescript
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
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/request-context.ts src/lib/logger.ts middleware.ts
git commit -m "feat: add request ID + rate limiting middleware"
```

---

## Task 5: Health Check Endpoint

**Files:**
- Create: `src/app/api/health/route.ts`
- Modify: `Dockerfile`

- [ ] **Step 1: Create `src/app/api/health/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - start;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: { status: "healthy", latencyMs: dbLatencyMs },
      },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: {
          database: { status: "unhealthy", error: "Connection failed" },
        },
      },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 2: Add HEALTHCHECK to Dockerfile**

Add before the CMD line (line 27):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/health/route.ts Dockerfile
git commit -m "feat: add /api/health endpoint + Docker HEALTHCHECK"
```

---

## Task 6: AI Call Timeouts

**Files:**
- Modify: `src/lib/ai/anthropic.ts`
- Modify: `src/lib/ai/openai.ts`
- Modify: `src/lib/ai/gemini.ts`
- Modify: `src/lib/ai/mapping.ts`
- Modify: `src/lib/ai/validate-key.ts`

- [ ] **Step 1: Add 60s timeout to Anthropic extraction**

In `src/lib/ai/anthropic.ts` line 62, add `signal` to the `client.messages.create()` options:

```typescript
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: getExtractionSystemPrompt(),
    messages: [{ role: "user", content }],
    signal: AbortSignal.timeout(60_000),
  });
```

- [ ] **Step 2: Add 60s timeout to OpenAI extraction**

In `src/lib/ai/openai.ts` line 45, add `signal`:

```typescript
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    messages: [
      { role: "system", content: getExtractionSystemPrompt() },
      { role: "user", content: buildUserContent(request) },
    ],
    signal: AbortSignal.timeout(60_000),
  });
```

- [ ] **Step 3: Add 60s timeout to Gemini extraction**

In `src/lib/ai/gemini.ts`, replace line 38-41 with Promise.race pattern (Google SDK doesn't support AbortSignal on `generateContent`):

```typescript
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AppError("AI extraction timed out after 60s", 504, "AI_TIMEOUT")), 60_000)
  );

  const result = await Promise.race([
    model.generateContent([
      { inlineData: { mimeType, data: base64Data } },
      { text: getExtractionUserPrompt(request.fileName) },
    ]),
    timeoutPromise,
  ]);
```

- [ ] **Step 4: Add 30s timeouts to mapping calls in `src/lib/ai/mapping.ts`**

Add `signal: AbortSignal.timeout(30_000)` to `callAnthropic` (line 21) and `callOpenAI` (line 44) `create()` calls.

For `callGemini` (line 73), wrap with Promise.race:

```typescript
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AppError("AI mapping timed out after 30s", 504, "AI_TIMEOUT")), 30_000)
  );
  const result = await Promise.race([
    model.generateContent([{ text: userPrompt }]),
    timeoutPromise,
  ]);
```

- [ ] **Step 5: Add 15s timeouts to key validation in `src/lib/ai/validate-key.ts`**

Add `signal: AbortSignal.timeout(15_000)` to `validateAnthropicKey` (line 10) and `validateOpenAIKey` (line 31) `create()` calls.

For `validateGeminiKey` (line 53), wrap with Promise.race:

```typescript
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AppError("Key validation timed out", 504, "AI_TIMEOUT")), 15_000)
  );
  await Promise.race([model.generateContent("Hi"), timeoutPromise]);
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/anthropic.ts src/lib/ai/openai.ts src/lib/ai/gemini.ts src/lib/ai/mapping.ts src/lib/ai/validate-key.ts
git commit -m "feat: add timeouts to AI calls"
```

---

## Task 7: AI Call Retry Logic

**Files:**
- Create: `src/lib/retry.ts`
- Modify: `src/lib/ai/index.ts`
- Modify: `src/lib/ai/mapping.ts`

- [ ] **Step 1: Create `src/lib/retry.ts`**

```typescript
import { logger } from "@/lib/logger";

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  operation?: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes("fetch failed") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")) {
      return true;
    }
    if (err.name === "AbortError" || err.message.includes("timed out")) {
      return false;
    }
  }
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return RETRYABLE_STATUS_CODES.has(status);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 1000, operation = "operation" } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(
        { attempt: attempt + 1, maxRetries, delayMs: delay, operation, error: (err as Error).message },
        `Retrying ${operation} after transient failure`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
```

- [ ] **Step 2: Wrap extraction with retry in `src/lib/ai/index.ts`**

Replace the full file:

```typescript
import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export type { AIExtractionRequest, AIExtractionResponse, AIProvider } from "./types";
export type { AIMappingRequest, AIMappingResponse } from "./types";
export { proposeFieldMappings } from "./mapping";

export async function extractFieldsFromDocument(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  return withRetry(
    () => {
      switch (request.provider) {
        case "anthropic":
          return extractWithAnthropic(request);
        case "openai":
          return extractWithOpenAI(request);
        case "gemini":
          return extractWithGemini(request);
        default:
          throw new AppError(`Unsupported AI provider: ${request.provider}`, 400, "INVALID_PROVIDER");
      }
    },
    { maxRetries: 2, operation: `extraction:${request.provider}` }
  );
}
```

- [ ] **Step 3: Wrap mapping calls with retry in `src/lib/ai/mapping.ts`**

Add `import { withRetry } from "@/lib/retry";` at the top.

In `proposeFieldMappings`, replace each direct call in the switch statement with a `withRetry` wrapper. For example, the anthropic case (lines 104-108) becomes:

```typescript
    case "anthropic": {
      const result = await withRetry(
        () => callAnthropic(apiKey, systemPrompt, userPrompt),
        { maxRetries: 2, operation: "mapping:anthropic" }
      );
      rawText = result.rawText;
      rawResponse = result.rawResponse;
      break;
    }
```

Apply the same pattern to `openai` and `gemini` cases.

- [ ] **Step 4: Commit**

```bash
git add src/lib/retry.ts src/lib/ai/index.ts src/lib/ai/mapping.ts
git commit -m "feat: add retry with backoff for AI calls"
```

---

## Task 8: Error Boundaries

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/(dashboard)/error.tsx`

- [ ] **Step 1: Create root error boundary `src/app/error.tsx`**

```typescript
"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create dashboard error boundary `src/app/(dashboard)/error.tsx`**

```typescript
"use client";

import { AlertTriangle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          We encountered an error loading this page.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/error.tsx "src/app/(dashboard)/error.tsx"
git commit -m "feat: add error boundaries"
```

---

## Task 9: Seed Protection + Graceful Shutdown

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add production guard to `prisma/seed.ts`**

Add at the very top, before all imports:

```typescript
if (process.env.NODE_ENV === "production") {
  console.error("ERROR: Seed script cannot run in production.");
  process.exit(1);
}
```

- [ ] **Step 2: Add graceful shutdown to `src/lib/db.ts`**

The full file should be:

```typescript
import "@/lib/env";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

if (process.env.NODE_ENV === "production") {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts src/lib/db.ts
git commit -m "feat: add seed protection + graceful shutdown"
```

---

## Task 10: Update .env.example Documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example` with production notes**

Replace the Database line (line 1-2) with:

```
# Database (for production, add ?connection_limit=10&pool_timeout=30)
DATABASE_URL="postgresql://ivm:ivm_dev_password@localhost:5432/ivm_dev?schema=public"
```

Change LOG_LEVEL line (line 33-34) to:

```
# Logging (use "info" or "warn" in production)
LOG_LEVEL="debug"
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add production notes to .env.example"
```

---

## Task 11: Verify Build

- [ ] **Step 1: Run TypeScript type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any type issues introduced by the changes.

- [ ] **Step 2: Run the dev server and test health endpoint**

```bash
npm run dev
# In another terminal:
curl http://localhost:3000/api/health
```

Expected: `{"status":"healthy","timestamp":"...","uptime":...,"checks":{"database":{"status":"healthy","latencyMs":...}}}`

- [ ] **Step 3: Test rate limiting**

Hit an auth endpoint repeatedly:
```bash
for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/register -X POST -H "Content-Type: application/json" -d '{}'; echo; done
```

Expected: First 10 return 400 (validation error), requests 11+ return 429.

- [ ] **Step 4: Test security headers**

```bash
curl -s -I http://localhost:3000 | grep -i "x-frame-options\|x-content-type\|strict-transport\|content-security"
```

Expected: All four headers present.

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete phase 7 production hardening"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `env.ts`, `db.ts` | Env validation — fail fast on missing/invalid config |
| 2 | `next.config.ts` | Security headers — CSP, HSTS, clickjacking protection |
| 3 | `rate-limit.ts` | In-memory rate limiter — global, auth, AI limiters |
| 4 | `request-context.ts`, `logger.ts`, `middleware.ts` | Request ID + rate limiting + middleware rewrite |
| 5 | `health/route.ts`, `Dockerfile` | Health check endpoint + Docker HEALTHCHECK |
| 6 | 5 AI files | Timeouts — 60s extraction, 30s mapping, 15s validation |
| 7 | `retry.ts`, `ai/index.ts`, `ai/mapping.ts` | Retry with exponential backoff for transient AI failures |
| 8 | 2 `error.tsx` files | Error boundaries for root + dashboard |
| 9 | `seed.ts`, `db.ts` | Seed protection + graceful shutdown |
| 10 | `.env.example` | Production documentation |
| 11 | — | Build verification |

**Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

**What's deferred to Phase 8:**
- Redis integration (caching, persistent rate limiting)
- Background job queue (Bull/BullMQ for async AI extraction)
- Error tracking service (Sentry)
- Prometheus metrics
- S3 storage adapter implementation
- API documentation (OpenAPI/Swagger)
