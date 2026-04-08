# Phase 8: Deferred Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 11 deferred items from Phases 2, 5, and 7 — Redis integration, S3 storage, DOCX extraction, DOCX placeholder normalization, partial re-fill, fill preview, nonce-based CSP, background job queue, Sentry error tracking, Prometheus metrics, and OpenAPI documentation.

**Architecture:** Infrastructure-first approach — Redis and S3 are foundational services that other features depend on (BullMQ needs Redis). Then UX improvements (DOCX fixes, partial re-fill, fill preview). Then security (CSP nonce). Then observability (Sentry, Prometheus). Finally documentation (OpenAPI).

**Tech Stack:** ioredis, @aws-sdk/client-s3, bullmq, @sentry/nextjs, prom-client, swagger-ui-react, mammoth (already installed)

---

## File Structure

```
src/
  lib/
    redis.ts                          # Create — Redis client singleton
    rate-limit.ts                     # Modify — Redis-backed rate limiting
    storage/
      s3.ts                           # Modify — Complete S3 implementation
    ai/
      index.ts                        # Modify — Add DOCX text extraction path
      anthropic.ts                    # Modify — Support text-only extraction
      openai.ts                       # Modify — Support text-only extraction
      gemini.ts                       # Modify — Support text-only extraction
      docx-extractor.ts              # Create — mammoth text extraction
    fill/
      docx-filler.ts                  # Modify — Run normalization before fill
      docx-normalize.ts              # Create — XML run normalization
      index.ts                        # Modify — Support partial re-fill mode
    queue/
      connection.ts                   # Create — BullMQ connection factory
      extraction-queue.ts            # Create — Extraction job queue + worker
    metrics.ts                        # Create — Prometheus metrics registry
    sentry.ts                         # Create — Sentry helpers
    env.ts                            # Modify — New env vars (REDIS_URL, S3_*, SENTRY_DSN)
  app/
    api/
      health/route.ts                 # Modify — Add Redis health check
      sessions/[id]/
        extract/route.ts              # Modify — Enqueue to BullMQ instead of inline
        fill/
          route.ts                    # Modify — Support retryFieldIds for partial re-fill
          preview/route.ts            # Create — Fill preview endpoint
      metrics/route.ts                # Create — Prometheus metrics endpoint
      docs/route.ts                   # Create — OpenAPI spec serving
    docs/
      page.tsx                        # Create — Swagger UI page
  components/
    sessions/
      fill-step-client.tsx            # Modify — Add preview step + retry per field
      fill-actions-table.tsx          # Modify — Add retry button per failed field
  lib/
    validations/
      fill.ts                         # Modify — Add retryFieldIds to schema
  middleware.ts → middleware.ts        # Modify — CSP nonce generation
  next.config.ts                      # Modify — Remove static CSP (moved to middleware)
  sentry.client.config.ts             # Create — Sentry client config
  sentry.server.config.ts             # Create — Sentry server config
  openapi.yaml                        # Create — OpenAPI 3.0 specification
```

---

### Task 1: Redis Client & Redis-Backed Rate Limiting

**Files:**
- Create: `src/lib/redis.ts`
- Modify: `src/lib/rate-limit.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/app/api/health/route.ts`

- [ ] **Step 1: Add ioredis dependency**

```bash
npm install ioredis
```

- [ ] **Step 2: Add REDIS_URL to env validation**

In `src/lib/env.ts`, the `REDIS_URL` field already exists as optional. No change needed — it's already:
```typescript
REDIS_URL: z.string().optional(),
```

- [ ] **Step 3: Create Redis client singleton**

Create `src/lib/redis.ts`:

```typescript
import Redis from "ioredis";
import { logger } from "@/lib/logger";

let cachedClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (cachedClient) return cachedClient;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  cachedClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  cachedClient.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });

  cachedClient.on("connect", () => {
    logger.info("Redis connected");
  });

  return cachedClient;
}

export async function disconnectRedis(): Promise<void> {
  if (cachedClient) {
    await cachedClient.quit();
    cachedClient = null;
  }
}
```

- [ ] **Step 4: Refactor rate limiter to support Redis backend**

Replace `src/lib/rate-limit.ts` entirely:

```typescript
import { getRedisClient } from "./redis";

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

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createInMemoryStore() {
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);

  if (cleanupInterval.unref) cleanupInterval.unref();

  return {
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const now = Date.now();

      if (store.size > 10_000) {
        for (const [k, e] of store) {
          if (e.resetAt <= now) store.delete(k);
        }
      }

      const entry = store.get(key);

      if (!entry || entry.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs };
      }

      entry.count += 1;
      return {
        allowed: entry.count <= limit,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: entry.resetAt,
      };
    },
  };
}

function createRedisStore() {
  return {
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const redis = getRedisClient();
      if (!redis) {
        return inMemoryStore.check(key, limit, windowMs);
      }

      const now = Date.now();
      const windowKey = `rl:${key}:${Math.floor(now / windowMs)}`;
      const windowExpirySec = Math.ceil(windowMs / 1000) + 1;

      try {
        const count = await redis.incr(windowKey);
        if (count === 1) {
          await redis.expire(windowKey, windowExpirySec);
        }

        const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;

        return {
          allowed: count <= limit,
          limit,
          remaining: Math.max(0, limit - count),
          resetAt,
        };
      } catch {
        return inMemoryStore.check(key, limit, windowMs);
      }
    },
  };
}

const inMemoryStore = createInMemoryStore();
const redisStore = createRedisStore();

export function createRateLimiter(config: RateLimitConfig) {
  return function check(key: string): Promise<RateLimitResult> {
    const redis = getRedisClient();
    const store = redis ? redisStore : inMemoryStore;
    return store.check(key, config.limit, config.windowMs);
  };
}

/** 100 req/min per IP for all API routes */
export const globalLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 });

/** 10 req/min per IP for auth routes (login, register) */
export const authLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** 5 req/min per user for AI routes (extract, mapping) */
export const aiLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
```

- [ ] **Step 5: Update middleware for async rate limiter**

The rate limiter is now async. Update `middleware.ts` — the `check()` calls now return promises. Replace the auth callback body to await rate limit checks:

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

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();
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
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
});

export const config = {
  matcher: [
    "/((?!api/auth/(?!register)|api/health|api/metrics|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

- [ ] **Step 6: Add Redis health check**

Update `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRedisClient } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch {
    checks.database = { status: "unhealthy", error: "Connection failed" };
  }

  const redis = getRedisClient();
  if (redis) {
    const redisStart = Date.now();
    try {
      await redis.ping();
      checks.redis = { status: "healthy", latencyMs: Date.now() - redisStart };
    } catch {
      checks.redis = { status: "unhealthy", error: "Connection failed" };
    }
  } else {
    checks.redis = { status: "not_configured" };
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status === "healthy" || c.status === "not_configured"
  );

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
```

- [ ] **Step 7: Update graceful shutdown in db.ts**

Add Redis disconnect to the existing SIGTERM/SIGINT handlers in `src/lib/db.ts`. Find the shutdown handler and add:

```typescript
import { disconnectRedis } from "@/lib/redis";

// In the existing shutdown handler, add after prisma disconnect:
await disconnectRedis();
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/redis.ts src/lib/rate-limit.ts src/lib/env.ts src/app/api/health/route.ts src/lib/db.ts middleware.ts package.json package-lock.json
git commit -m "feat: add Redis integration for rate limiting"
```

---

### Task 2: S3 Storage Adapter

**Files:**
- Modify: `src/lib/storage/s3.ts`
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Install AWS SDK**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Add S3 env vars to validation**

In `src/lib/env.ts`, add to `envSchema`:

```typescript
S3_BUCKET: z.string().optional(),
S3_REGION: z.string().default("ap-southeast-1"),
S3_ACCESS_KEY_ID: z.string().optional(),
S3_SECRET_ACCESS_KEY: z.string().optional(),
S3_ENDPOINT: z.string().optional(),
```

- [ ] **Step 3: Implement S3 adapter**

Replace `src/lib/storage/s3.ts`:

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./index";

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET environment variable is required for S3 storage");

    this.bucket = bucket;
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "ap-southeast-1",
      ...(process.env.S3_ENDPOINT && { endpoint: process.env.S3_ENDPOINT }),
      ...(process.env.S3_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        },
      }),
    });
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const stream = response.Body;
    if (!stream) throw new Error(`Empty response for key: ${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async getUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage/s3.ts src/lib/env.ts package.json package-lock.json
git commit -m "feat: implement S3 storage adapter"
```

---

### Task 3: DOCX Source Extraction

**Files:**
- Create: `src/lib/ai/docx-extractor.ts`
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/index.ts`
- Modify: `src/lib/ai/anthropic.ts`
- Modify: `src/lib/ai/openai.ts`
- Modify: `src/lib/ai/gemini.ts`
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 1: Create DOCX text extractor using mammoth**

Create `src/lib/ai/docx-extractor.ts`:

```typescript
import mammoth from "mammoth";

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  if (!result.value || result.value.trim().length === 0) {
    throw new Error("DOCX document contains no extractable text");
  }
  return result.value;
}
```

- [ ] **Step 2: Add text extraction prompt**

In `src/lib/ai/prompts.ts`, add after `getExtractionUserPrompt`:

```typescript
export function getTextExtractionUserPrompt(fileName: string, textContent: string): string {
  return `Extract all data fields from this document: "${fileName}".

Document text content:
---
${textContent}
---

Return the JSON response as specified.`;
}
```

- [ ] **Step 3: Add textContent to AIExtractionRequest**

In `src/lib/ai/types.ts`, add an optional field to `AIExtractionRequest`:

```typescript
export interface AIExtractionRequest {
  sourceAssetId: string;
  mimeType: string;
  fileData: Buffer;
  fileName: string;
  provider: AIProvider;
  apiKey: string;
  textContent?: string; // Pre-extracted text for DOCX files
}
```

- [ ] **Step 4: Update Anthropic adapter to support text-only extraction**

In `src/lib/ai/anthropic.ts`, modify `buildContentBlocks` to handle text-only input. Add at the top of the function, before the image check:

```typescript
function buildContentBlocks(
  request: AIExtractionRequest
): Anthropic.MessageCreateParams["messages"][0]["content"] {
  // Text-only extraction (e.g., DOCX pre-extracted via mammoth)
  if (request.textContent) {
    return [
      { type: "text" as const, text: getTextExtractionUserPrompt(request.fileName, request.textContent) },
    ];
  }

  const base64Data = request.fileData.toString("base64");
  // ... rest of existing function unchanged
```

Add `getTextExtractionUserPrompt` to the imports from `./prompts`.

- [ ] **Step 5: Update OpenAI adapter to support text-only extraction**

In `src/lib/ai/openai.ts`, modify `buildUserContent`. Add at the top of the function:

```typescript
function buildUserContent(request: AIExtractionRequest): OpenAI.ChatCompletionContentPart[] {
  if (request.textContent) {
    return [
      { type: "text", text: getTextExtractionUserPrompt(request.fileName, request.textContent) },
    ];
  }

  const base64Data = request.fileData.toString("base64");
  // ... rest unchanged
```

Add `getTextExtractionUserPrompt` to the imports from `./prompts`.

- [ ] **Step 6: Update Gemini adapter to support text-only extraction**

In `src/lib/ai/gemini.ts`, modify `extractWithGemini`. Replace the mimeType check and content construction:

```typescript
export async function extractWithGemini(request: AIExtractionRequest): Promise<AIExtractionResponse> {
  // Text-only extraction (e.g., DOCX)
  if (request.textContent) {
    logger.info(
      { sourceAssetId: request.sourceAssetId, mimeType: request.mimeType, fileName: request.fileName, provider: "gemini" },
      "Starting AI extraction (text-only)"
    );

    const genAI = new GoogleGenerativeAI(request.apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: getExtractionSystemPrompt(),
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new AppError("AI extraction timed out after 60s", 504, "AI_TIMEOUT")), 60_000);
    });

    let result: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      result = await Promise.race([
        model.generateContent([{ text: getTextExtractionUserPrompt(request.fileName, request.textContent) }]),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = result.response.text();
    if (!text) throw new AppError("AI returned no text response", 500, "AI_EMPTY_RESPONSE");

    const { documentType, fields } = parseExtractionResponse(text);
    logger.info({ sourceAssetId: request.sourceAssetId, documentType, fieldCount: fields.length }, "AI extraction completed");
    return { documentType, fields, rawResponse: result.response };
  }

  // Original binary extraction path
  const mimeType = MIME_MAP[request.mimeType];
  if (!mimeType) {
    throw new AppError(
      `Extraction not supported for file type: ${request.mimeType}. Supported: PDF, PNG, JPG, WebP, DOCX.`,
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }
  // ... rest unchanged
```

Add `getTextExtractionUserPrompt` to the imports from `./prompts`.

- [ ] **Step 7: Update extraction dispatcher to handle DOCX**

In `src/lib/ai/index.ts`, add the DOCX pre-processing:

```typescript
import { AppError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { extractTextFromDocx } from "./docx-extractor";
import { extractWithAnthropic } from "./anthropic";
import { extractWithOpenAI } from "./openai";
import { extractWithGemini } from "./gemini";
import type { AIExtractionRequest, AIExtractionResponse } from "./types";

export type { AIExtractionRequest, AIExtractionResponse, AIProvider } from "./types";
export type { AIMappingRequest, AIMappingResponse } from "./types";
export { proposeFieldMappings } from "./mapping";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractFieldsFromDocument(
  request: AIExtractionRequest
): Promise<AIExtractionResponse> {
  let enrichedRequest = request;

  if (request.mimeType === DOCX_MIME) {
    const textContent = await extractTextFromDocx(request.fileData);
    enrichedRequest = { ...request, textContent };
  }

  return withRetry(
    () => {
      switch (enrichedRequest.provider) {
        case "anthropic":
          return extractWithAnthropic(enrichedRequest);
        case "openai":
          return extractWithOpenAI(enrichedRequest);
        case "gemini":
          return extractWithGemini(enrichedRequest);
        default:
          throw new AppError(`Unsupported AI provider: ${enrichedRequest.provider}`, 400, "INVALID_PROVIDER");
      }
    },
    { maxRetries: 2, operation: `extraction:${enrichedRequest.provider}` }
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/docx-extractor.ts src/lib/ai/types.ts src/lib/ai/index.ts src/lib/ai/anthropic.ts src/lib/ai/openai.ts src/lib/ai/gemini.ts src/lib/ai/prompts.ts
git commit -m "feat: add DOCX source document extraction"
```

---

### Task 4: DOCX Placeholder Run Normalization

**Files:**
- Create: `src/lib/fill/docx-normalize.ts`
- Modify: `src/lib/fill/docx-filler.ts`

- [ ] **Step 1: Create XML run normalizer**

Create `src/lib/fill/docx-normalize.ts`:

```typescript
/**
 * Normalizes DOCX XML to merge split placeholder text across formatting runs.
 *
 * Word often splits `{{placeholder}}` across multiple <w:r> elements due to
 * spell-check, formatting, or editing history. For example:
 *   <w:r><w:t>{{</w:t></w:r><w:r><w:t>name</w:t></w:r><w:r><w:t>}}</w:t></w:r>
 *
 * This function detects split placeholders and merges them into single runs.
 */
export function normalizeDocxRuns(xml: string): string {
  // Match sequences of adjacent <w:r> elements whose combined text forms a placeholder
  // Strategy: find all {{...}} patterns that span multiple <w:r> elements and merge them

  // Step 1: Extract all <w:r>...</w:r> blocks with their text
  const runPattern = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const textInRunPattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

  let result = xml;
  let changed = true;

  // Iterate until no more merges are needed (handles nested splits)
  while (changed) {
    changed = false;

    // Find sequences of runs where combined text contains a placeholder
    const runs: Array<{ match: string; text: string; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    const freshPattern = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;

    while ((m = freshPattern.exec(result)) !== null) {
      let text = "";
      let tm: RegExpExecArray | null;
      const tp = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      while ((tm = tp.exec(m[0])) !== null) {
        text += tm[1];
      }
      runs.push({ match: m[0], text, start: m.index, end: m.index + m[0].length });
    }

    // Look for adjacent runs whose combined text contains {{ and }}
    for (let i = 0; i < runs.length; i++) {
      // Build up combined text from run i forward
      let combined = "";
      let j = i;
      while (j < runs.length && j - i < 10) {
        combined += runs[j].text;
        // Check if combined text contains a complete placeholder
        const placeholderMatch = combined.match(/\{\{[^}]+\}\}/);
        if (placeholderMatch && j > i) {
          // These runs (i through j) form a split placeholder — merge them
          const mergedText = combined;
          // Use the first run's formatting, replace its text, remove the rest
          const firstRun = runs[i].match;
          const mergedRun = firstRun.replace(
            /<w:t[^>]*>[\s\S]*?<\/w:t>/,
            `<w:t xml:space="preserve">${mergedText}</w:t>`
          );

          const before = result.substring(0, runs[i].start);
          const after = result.substring(runs[j].end);
          // Remove any whitespace/newlines between runs (but keep them if they're not just between runs)
          let between = result.substring(runs[i].end, runs[j].end);
          // Replace all the original runs with the merged one
          const originalSpan = result.substring(runs[i].start, runs[j].end);
          result = before + mergedRun + after;

          changed = true;
          break;
        }
        j++;
      }
      if (changed) break;
    }
  }

  return result;
}
```

- [ ] **Step 2: Apply normalization in DOCX filler**

In `src/lib/fill/docx-filler.ts`, import and apply the normalizer before placeholder search. After reading `docXml`:

```typescript
import { normalizeDocxRuns } from "./docx-normalize";

// ... in fillDocx function, after:
// let docXml = await docXmlFile.async("string");

// Add:
docXml = normalizeDocxRuns(docXml);
```

The full modified section of `fillDocx` (lines 54-55 area):

```typescript
  let docXml = await docXmlFile.async("string");
  docXml = normalizeDocxRuns(docXml);
  const results: FillFieldResult[] = [];
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/fill/docx-normalize.ts src/lib/fill/docx-filler.ts
git commit -m "feat: normalize DOCX XML runs for split placeholders"
```

---

### Task 5: Partial Re-fill (Retry Failed Fields)

**Files:**
- Modify: `src/lib/validations/fill.ts`
- Modify: `src/app/api/sessions/[id]/fill/route.ts`
- Modify: `src/components/sessions/fill-actions-table.tsx`
- Modify: `src/components/sessions/fill-step-client.tsx`

- [ ] **Step 1: Add retryFieldIds to fill validation schema**

Replace `src/lib/validations/fill.ts`:

```typescript
import { z } from "zod";

export const executeFillSchema = z.object({
  skipFieldIds: z.array(z.string()).optional(),
  retryFieldIds: z.array(z.string()).optional(),
});

export type ExecuteFillInput = z.infer<typeof executeFillSchema>;
```

- [ ] **Step 2: Update fill route to support partial re-fill**

In `src/app/api/sessions/[id]/fill/route.ts`, modify the POST handler. After fetching the session data and before building fill context, add the partial re-fill logic:

Replace the section that deletes all fill actions (line 65: `await db.fillAction.deleteMany(...)`) with:

```typescript
    const isPartialRetry = parsed.data.retryFieldIds && parsed.data.retryFieldIds.length > 0;

    if (isPartialRetry) {
      // Only delete the specific failed fields being retried
      await db.fillAction.deleteMany({
        where: {
          fillSessionId: id,
          targetFieldId: { in: parsed.data.retryFieldIds },
        },
      });
    } else {
      // Full re-fill: delete all existing actions
      await db.fillAction.deleteMany({ where: { fillSessionId: id } });
    }
```

Then modify the `buildFillContext` call to filter mappings to only retry fields when doing partial re-fill. Add `retryFieldIds` filtering:

```typescript
    // For partial retry, only include the specific fields
    const effectiveMappings = isPartialRetry
      ? mappings.filter((m) => parsed.data.retryFieldIds!.includes(m.targetFieldId))
      : mappings;

    const ctx = buildFillContext({
      sessionId: id,
      mappingSetId: mappingSet.id,
      targetType: targetAsset.targetType as TargetType,
      targetFields,
      mappings: effectiveMappings,
      storagePath: targetAsset.storagePath,
      targetUrl: targetAsset.url,
      targetFileName: targetAsset.fileName,
      skipFieldIds: parsed.data.skipFieldIds,
    });
```

After creating new fill actions, for partial retry, also fetch the existing successful actions to return a complete picture:

```typescript
    // For partial retry, fetch all actions (existing + new) to return complete state
    const dbActions = await db.fillAction.findMany({
      where: { fillSessionId: id },
    });
```

This line already exists and fetches all actions — no change needed there.

- [ ] **Step 3: Add retry button to fill actions table**

Modify `src/components/sessions/fill-actions-table.tsx` — add an `onRetry` callback prop:

```typescript
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FillActionSummary, FillActionStatus } from "@/types/fill";

interface FillActionsTableProps {
  actions: FillActionSummary[];
  onRetryField?: (targetFieldId: string) => void;
  retryingFieldId?: string | null;
}

const STATUS_VARIANT: Record<
  FillActionStatus,
  "success" | "warning" | "error" | "secondary" | "info"
> = {
  VERIFIED: "success",
  APPLIED: "info",
  PENDING: "secondary",
  FAILED: "error",
  SKIPPED: "warning",
};

const STATUS_LABEL: Record<FillActionStatus, string> = {
  VERIFIED: "Verified",
  APPLIED: "Applied",
  PENDING: "Pending",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export function FillActionsTable({ actions, onRetryField, retryingFieldId }: FillActionsTableProps) {
  if (actions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No fill actions to display.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Target Field
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Intended Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Applied Value
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Status
            </th>
            {onRetryField && (
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr
              key={action.id}
              className="border-b border-border last:border-0"
            >
              <td className="px-4 py-2 font-medium text-foreground">
                {action.targetLabel}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <span
                  className="inline-block max-w-[200px] truncate"
                  title={action.intendedValue}
                >
                  {action.intendedValue}
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {action.status === "VERIFIED" ? (
                  <span
                    className="text-emerald-500"
                    title={action.verifiedValue ?? undefined}
                  >
                    {action.verifiedValue ?? "\u2014"}
                  </span>
                ) : action.appliedValue ? (
                  <span title={action.appliedValue}>{action.appliedValue}</span>
                ) : (
                  <span className="text-muted-foreground/50">{"\u2014"}</span>
                )}
              </td>
              <td className="px-4 py-2">
                <Badge variant={STATUS_VARIANT[action.status]}>
                  {STATUS_LABEL[action.status]}
                </Badge>
                {action.errorMessage && (
                  <p className="mt-1 text-xs text-red-500">
                    {action.errorMessage}
                  </p>
                )}
              </td>
              {onRetryField && (
                <td className="px-4 py-2">
                  {action.status === "FAILED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryField(action.targetFieldId)}
                      disabled={retryingFieldId === action.targetFieldId}
                    >
                      <RotateCcw className={`mr-1 h-3 w-3 ${retryingFieldId === action.targetFieldId ? "animate-spin" : ""}`} />
                      Retry
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Wire retry into fill-step-client**

In `src/components/sessions/fill-step-client.tsx`, add the retry handler and pass to table:

Add state:
```typescript
const [retryingFieldId, setRetryingFieldId] = useState<string | null>(null);
```

Add handler after `handleExecute`:
```typescript
  const handleRetryField = useCallback(async (targetFieldId: string) => {
    setRetryingFieldId(targetFieldId);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFieldIds: [targetFieldId] }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Retry failed");
      }

      const result = await res.json();
      setFillData(result);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed";
      setError(message);
    } finally {
      setRetryingFieldId(null);
    }
  }, [sessionId, router]);
```

Update the `<FillActionsTable>` render to pass the new props:
```typescript
<FillActionsTable
  actions={fillData.actions}
  onRetryField={handleRetryField}
  retryingFieldId={retryingFieldId}
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/fill.ts src/app/api/sessions/[id]/fill/route.ts src/components/sessions/fill-actions-table.tsx src/components/sessions/fill-step-client.tsx
git commit -m "feat: add partial re-fill for individual failed fields"
```

---

### Task 6: Fill Preview

**Files:**
- Create: `src/app/api/sessions/[id]/fill/preview/route.ts`
- Modify: `src/components/sessions/fill-step-client.tsx`

- [ ] **Step 1: Create fill preview API endpoint**

Create `src/app/api/sessions/[id]/fill/preview/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildFillContext } from "@/lib/fill";
import type { FieldMapping } from "@/types/mapping";
import type { TargetField, TargetType } from "@/types/target";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        targetAssets: { orderBy: { inspectedAt: "desc" }, take: 1 },
        mappingSets: {
          where: { status: "ACCEPTED" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const mappingSet = fillSession.mappingSets[0];
    if (!mappingSet) {
      throw new ValidationError("No accepted mapping set. Accept mappings first.");
    }

    const targetAsset = fillSession.targetAssets[0];
    if (!targetAsset) {
      throw new ValidationError("No target asset found.");
    }

    const mappings = mappingSet.mappings as unknown as FieldMapping[];
    const targetFields = targetAsset.detectedFields as unknown as TargetField[];

    const ctx = buildFillContext({
      sessionId: id,
      mappingSetId: mappingSet.id,
      targetType: targetAsset.targetType as TargetType,
      targetFields,
      mappings,
      storagePath: targetAsset.storagePath,
      targetUrl: targetAsset.url,
      targetFileName: targetAsset.fileName,
    });

    const preview = ctx.approvedMappings.map((m) => {
      const targetField = targetFields.find((f) => f.id === m.targetFieldId);
      return {
        targetFieldId: m.targetFieldId,
        targetLabel: targetField?.label ?? m.targetLabel,
        sourceLabel: m.sourceLabel,
        sourceValue: m.sourceValue,
        intendedValue: m.userOverrideValue ?? m.transformedValue,
        hasOverride: !!m.userOverrideValue,
      };
    });

    return NextResponse.json({
      preview,
      totalFields: preview.length,
      targetType: targetAsset.targetType,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Add preview state to fill-step-client**

In `src/components/sessions/fill-step-client.tsx`, add a preview step before execution. Add imports and state:

```typescript
import { Play, ArrowRight, Download, RotateCcw, Eye } from "lucide-react";
```

Add interfaces and state after existing state declarations:

```typescript
interface PreviewField {
  targetFieldId: string;
  targetLabel: string;
  sourceLabel: string;
  sourceValue: string;
  intendedValue: string;
  hasOverride: boolean;
}

// Inside the component, add:
const [preview, setPreview] = useState<PreviewField[] | null>(null);
const [previewLoading, setPreviewLoading] = useState(false);
```

Add preview handler after `handleRetryField`:

```typescript
  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fill/preview`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Preview failed");
      }
      const data = await res.json();
      setPreview(data.preview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId]);
```

Update the idle/failed state buttons to show Preview first:

```typescript
{(fillState === "idle" || fillState === "failed") && (
  <>
    <Button variant="outline" onClick={handlePreview} disabled={previewLoading}>
      <Eye className="mr-2 h-4 w-4" />
      {previewLoading ? "Loading..." : "Preview"}
    </Button>
    <Button onClick={handleExecute}>
      <Play className="mr-2 h-4 w-4" />
      {fillState === "failed" ? "Retry Fill" : "Execute Fill"}
    </Button>
  </>
)}
```

Add preview table render before the fill results section:

```typescript
{preview && fillState !== "completed" && (
  <div className="space-y-3">
    <h3 className="text-sm font-medium text-foreground">
      Fill Preview ({preview.length} fields)
    </h3>
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Target Field</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Source</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Value to Fill</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((field) => (
            <tr key={field.targetFieldId} className="border-b border-border last:border-0">
              <td className="px-4 py-2 font-medium text-foreground">{field.targetLabel}</td>
              <td className="px-4 py-2 text-muted-foreground">{field.sourceLabel}</td>
              <td className="px-4 py-2 text-foreground">
                {field.intendedValue}
                {field.hasOverride && (
                  <span className="ml-2 text-xs text-amber-500">(edited)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sessions/[id]/fill/preview/route.ts src/components/sessions/fill-step-client.tsx
git commit -m "feat: add fill preview before execution"
```

---

### Task 7: Nonce-Based CSP

**Files:**
- Modify: `middleware.ts`
- Modify: `next.config.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Remove static CSP from next.config.ts**

In `next.config.ts`, remove the CSP header from the `headers()` array. Keep all other headers. Replace the entire Content-Security-Policy entry with nothing — CSP will now be set dynamically in middleware.

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
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Add CSP nonce generation to middleware**

In `middleware.ts`, generate a nonce and set the CSP header dynamically. Add nonce generation at the top of the auth callback, and set the CSP header on the response.

After generating `requestId`, add:

```typescript
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
```

Before returning the `NextResponse.next()` at the end, build the CSP:

```typescript
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  return response;
```

**Important**: `'strict-dynamic'` allows scripts loaded by a nonced script to execute without their own nonce. This is how Next.js's chunk-loading works. Keep `'unsafe-inline'` for `style-src` because Tailwind and component libraries inject inline styles.

**Note**: If `'strict-dynamic'` causes issues with Next.js chunk loading in production, fall back to `'unsafe-eval'` alongside the nonce. Test this after deployment.

- [ ] **Step 3: Pass nonce to layout for Script components**

Read `src/app/layout.tsx` and find the `<html>` + `<body>` wrapper. Import headers and pass nonce to any `<Script>` components if present.

In `src/app/layout.tsx`, add:

```typescript
import { headers } from "next/headers";

// Inside the layout component:
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const nonce = headerList.get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body nonce={nonce}>
        {children}
      </body>
    </html>
  );
}
```

If there are `<Script>` tags, add `nonce={nonce}` to each.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts next.config.ts src/app/layout.tsx
git commit -m "feat: add nonce-based CSP for script security"
```

---

### Task 8: Background Job Queue (BullMQ)

**Files:**
- Create: `src/lib/queue/connection.ts`
- Create: `src/lib/queue/extraction-queue.ts`
- Modify: `src/app/api/sessions/[id]/extract/route.ts`

- [ ] **Step 1: Install BullMQ**

```bash
npm install bullmq
```

- [ ] **Step 2: Create BullMQ connection factory**

Create `src/lib/queue/connection.ts`:

```typescript
import { type ConnectionOptions } from "bullmq";
import { logger } from "@/lib/logger";

let cachedConnection: ConnectionOptions | null = null;

export function getQueueConnection(): ConnectionOptions | null {
  if (cachedConnection) return cachedConnection;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn("REDIS_URL not set — background queue disabled, using inline execution");
    return null;
  }

  // Parse redis://host:port format for BullMQ
  const parsed = new URL(url);
  cachedConnection = {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    ...(parsed.password && { password: parsed.password }),
  };

  return cachedConnection;
}
```

- [ ] **Step 3: Create extraction queue and worker**

Create `src/lib/queue/extraction-queue.ts`:

```typescript
import { Queue, Worker } from "bullmq";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { extractFieldsFromDocument } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { getQueueConnection } from "./connection";
import type { AIProvider } from "@/lib/ai";

const QUEUE_NAME = "extraction";

interface ExtractionJobData {
  sessionId: string;
  extractionId: string;
  sourceAssetId: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  provider: AIProvider;
  apiKey: string;
  userId: string;
}

let queue: Queue<ExtractionJobData> | null = null;
let worker: Worker<ExtractionJobData> | null = null;

export function getExtractionQueue(): Queue<ExtractionJobData> | null {
  if (queue) return queue;

  const connection = getQueueConnection();
  if (!connection) return null;

  queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

export function startExtractionWorker(): void {
  const connection = getQueueConnection();
  if (!connection) return;
  if (worker) return;

  worker = new Worker<ExtractionJobData>(
    QUEUE_NAME,
    async (job) => {
      const { sessionId, extractionId, sourceAssetId, storagePath, originalName, mimeType, provider, apiKey, userId } = job.data;

      logger.info({ sessionId, extractionId, provider, jobId: job.id }, "Processing extraction job");

      try {
        const storage = getStorageAdapter();
        const fileData = await storage.download(storagePath);

        const result = await extractFieldsFromDocument({
          sourceAssetId,
          mimeType,
          fileData,
          fileName: originalName,
          provider,
          apiKey,
        });

        await Promise.all([
          db.extractionResult.update({
            where: { id: extractionId },
            data: {
              status: "COMPLETED",
              documentType: result.documentType,
              fields: JSON.parse(JSON.stringify(result.fields)),
              rawResponse: JSON.parse(JSON.stringify(result.rawResponse)),
              completedAt: new Date(),
            },
          }),
          db.fillSession.updateMany({
            where: { id: sessionId, userId },
            data: { status: "EXTRACTED", currentStep: "EXTRACT" },
          }),
          db.auditEvent.create({
            data: {
              fillSessionId: sessionId,
              eventType: "EXTRACTION_COMPLETED",
              actor: "SYSTEM",
              payload: {
                extractionId,
                provider,
                documentType: result.documentType,
                fieldCount: result.fields.length,
                async: true,
              },
            },
          }),
        ]);

        logger.info({ sessionId, extractionId, fieldCount: result.fields.length }, "Extraction job completed");
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown extraction error";

        await Promise.all([
          db.extractionResult.update({
            where: { id: extractionId },
            data: { status: "FAILED", errorMessage, completedAt: new Date() },
          }),
          db.auditEvent.create({
            data: {
              fillSessionId: sessionId,
              eventType: "EXTRACTION_FAILED",
              actor: "SYSTEM",
              payload: { extractionId, provider, error: errorMessage, async: true },
            },
          }),
        ]);

        logger.error({ err, sessionId, extractionId }, "Extraction job failed");
        throw err;
      }
    },
    {
      connection,
      concurrency: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  worker.on("error", (err) => {
    logger.error({ err }, "Extraction worker error");
  });

  logger.info("Extraction worker started");
}

// Auto-start worker when module is loaded on the server
if (typeof window === "undefined") {
  startExtractionWorker();
}
```

- [ ] **Step 4: Update extract route to enqueue when Redis is available**

Modify `src/app/api/sessions/[id]/extract/route.ts`. The route should check if a queue is available; if so, enqueue the job and return immediately. If not, fall back to inline execution (current behavior).

Replace the POST handler:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { extractFieldsFromDocument } from "@/lib/ai";
import { resolveProviderAndKey } from "@/lib/ai/resolve-provider";
import { getExtractionQueue } from "@/lib/queue/extraction-queue";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError, AppError } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });
    if (!fillSession) throw new NotFoundError("Session", id);

    const sourceAsset = fillSession.sourceAssets[0];
    if (!sourceAsset) {
      throw new ValidationError("No source document uploaded. Upload a file first.");
    }

    const { provider, apiKey } = await resolveProviderAndKey(session.user.id);

    const extraction = await db.extractionResult.create({
      data: {
        fillSessionId: id,
        sourceAssetId: sourceAsset.id,
        provider,
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

    // Try async queue first, fall back to inline
    const queue = getExtractionQueue();
    if (queue) {
      await queue.add("extract", {
        sessionId: id,
        extractionId: extraction.id,
        sourceAssetId: sourceAsset.id,
        storagePath: sourceAsset.storagePath,
        originalName: sourceAsset.originalName,
        mimeType: sourceAsset.mimeType,
        provider,
        apiKey,
        userId: session.user.id,
      });

      logger.info({ sessionId: id, extractionId: extraction.id, provider }, "Extraction enqueued");

      return NextResponse.json({
        ...extraction,
        async: true,
        message: "Extraction queued. Poll GET /extraction for results.",
      });
    }

    // Inline fallback (no Redis)
    try {
      const storage = getStorageAdapter();
      const fileData = await storage.download(sourceAsset.storagePath);

      const result = await extractFieldsFromDocument({
        sourceAssetId: sourceAsset.id,
        mimeType: sourceAsset.mimeType,
        fileData,
        fileName: sourceAsset.originalName,
        provider,
        apiKey,
      });

      const [updated] = await Promise.all([
        db.extractionResult.update({
          where: { id: extraction.id },
          data: {
            status: "COMPLETED",
            documentType: result.documentType,
            fields: JSON.parse(JSON.stringify(result.fields)),
            rawResponse: JSON.parse(JSON.stringify(result.rawResponse)),
            completedAt: new Date(),
          },
        }),
        db.fillSession.updateMany({
          where: { id, userId: session.user.id },
          data: { status: "EXTRACTED", currentStep: "EXTRACT" },
        }),
        db.auditEvent.create({
          data: {
            fillSessionId: id,
            eventType: "EXTRACTION_COMPLETED",
            actor: "SYSTEM",
            payload: {
              extractionId: extraction.id,
              provider,
              documentType: result.documentType,
              fieldCount: result.fields.length,
            },
          },
        }),
      ]);

      logger.info(
        { sessionId: id, extractionId: extraction.id, provider, fieldCount: result.fields.length },
        "Extraction completed"
      );

      return NextResponse.json(updated);
    } catch (aiErr) {
      const errorMessage = aiErr instanceof Error ? aiErr.message : "Unknown extraction error";

      await Promise.all([
        db.extractionResult.update({
          where: { id: extraction.id },
          data: { status: "FAILED", errorMessage, completedAt: new Date() },
        }),
        db.auditEvent.create({
          data: {
            fillSessionId: id,
            eventType: "EXTRACTION_FAILED",
            actor: "SYSTEM",
            payload: { extractionId: extraction.id, provider, error: errorMessage },
          },
        }),
      ]);

      logger.error(
        { err: aiErr, sessionId: id, extractionId: extraction.id, provider },
        "Extraction failed"
      );

      if (aiErr instanceof AppError) throw aiErr;
      throw new AppError(`Extraction failed: ${errorMessage}`, 500, "EXTRACTION_FAILED");
    }
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue/connection.ts src/lib/queue/extraction-queue.ts src/app/api/sessions/[id]/extract/route.ts package.json package-lock.json
git commit -m "feat: add BullMQ background extraction queue"
```

---

### Task 9: Sentry Error Tracking

**Files:**
- Create: `sentry.client.config.ts`
- Create: `sentry.server.config.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/app/error.tsx`
- Modify: `next.config.ts`

- [ ] **Step 1: Install Sentry**

```bash
npm install @sentry/nextjs
```

- [ ] **Step 2: Add SENTRY_DSN to env validation**

In `src/lib/env.ts`, add to `envSchema`:

```typescript
SENTRY_DSN: z.string().url().optional(),
```

- [ ] **Step 3: Create Sentry client config**

Create `sentry.client.config.ts` at project root:

```typescript
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
  });
}
```

- [ ] **Step 4: Create Sentry server config**

Create `sentry.server.config.ts` at project root:

```typescript
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 5: Add Sentry to error handler**

In `src/lib/errors.ts`, add Sentry capture for unhandled errors. At the end of the `errorResponse` function, before the generic 500 response:

```typescript
export function errorResponse(err: unknown): Response {
  const { NextResponse } = require("next/server");
  if (err instanceof ValidationError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.fieldErrors },
      { status: err.statusCode }
    );
  }
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode }
    );
  }
  const { logger } = require("@/lib/logger");
  logger.error({ err }, "Unhandled error");

  // Report unexpected errors to Sentry
  try {
    const Sentry = require("@sentry/nextjs");
    Sentry.captureException(err);
  } catch {
    // Sentry not configured — ignore
  }

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
```

- [ ] **Step 6: Add Sentry to error boundary**

In `src/app/error.tsx`, add Sentry reporting:

```typescript
"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const Sentry = require("@sentry/nextjs");
      Sentry.captureException(error);
    } catch {
      // Sentry not loaded
    }
  }, [error]);

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

- [ ] **Step 7: Wrap next.config with Sentry**

In `next.config.ts`:

```typescript
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
```

- [ ] **Step 8: Commit**

```bash
git add sentry.client.config.ts sentry.server.config.ts src/lib/env.ts src/lib/errors.ts src/app/error.tsx next.config.ts package.json package-lock.json
git commit -m "feat: add Sentry error tracking"
```

---

### Task 10: Prometheus Metrics

**Files:**
- Create: `src/lib/metrics.ts`
- Create: `src/app/api/metrics/route.ts`

- [ ] **Step 1: Install prom-client**

```bash
npm install prom-client
```

- [ ] **Step 2: Create metrics registry**

Create `src/lib/metrics.ts`:

```typescript
import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "ivm_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "path", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "ivm_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path"] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const aiExtractionTotal = new Counter({
  name: "ivm_ai_extraction_total",
  help: "Total AI extraction requests",
  labelNames: ["provider", "status"] as const,
  registers: [registry],
});

export const aiExtractionDuration = new Histogram({
  name: "ivm_ai_extraction_duration_seconds",
  help: "AI extraction duration in seconds",
  labelNames: ["provider"] as const,
  buckets: [1, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const fillExecutionTotal = new Counter({
  name: "ivm_fill_execution_total",
  help: "Total fill executions",
  labelNames: ["target_type", "status"] as const,
  registers: [registry],
});

export const sessionsCreatedTotal = new Counter({
  name: "ivm_sessions_created_total",
  help: "Total sessions created",
  registers: [registry],
});
```

- [ ] **Step 3: Create metrics endpoint**

Create `src/app/api/metrics/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { registry } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Basic auth check for metrics endpoint (optional — protect with a bearer token)
  const authHeader = req.headers.get("authorization");
  const metricsToken = process.env.METRICS_TOKEN;

  if (metricsToken && authHeader !== `Bearer ${metricsToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const metrics = await registry.metrics();
  return new Response(metrics, {
    headers: { "Content-Type": registry.contentType },
  });
}
```

- [ ] **Step 4: Add METRICS_TOKEN to env validation**

In `src/lib/env.ts`, add:

```typescript
METRICS_TOKEN: z.string().optional(),
```

- [ ] **Step 5: Instrument key routes**

Add metric recording to the extraction and fill routes. In `src/app/api/sessions/[id]/extract/route.ts`, after a successful extraction:

```typescript
import { aiExtractionTotal, aiExtractionDuration } from "@/lib/metrics";

// After successful extraction, add:
aiExtractionTotal.inc({ provider, status: "success" });

// Wrap the extraction call with timing:
const extractionStart = Date.now();
// ... extraction call ...
aiExtractionDuration.observe({ provider }, (Date.now() - extractionStart) / 1000);
```

In `src/app/api/sessions/[id]/fill/route.ts`, after successful fill:

```typescript
import { fillExecutionTotal } from "@/lib/metrics";

// After successful fill:
fillExecutionTotal.inc({ target_type: targetAsset.targetType, status: "success" });
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics.ts src/app/api/metrics/route.ts src/lib/env.ts src/app/api/sessions/[id]/extract/route.ts src/app/api/sessions/[id]/fill/route.ts package.json package-lock.json
git commit -m "feat: add Prometheus metrics endpoint"
```

---

### Task 11: OpenAPI Documentation

**Files:**
- Create: `src/app/api/docs/route.ts`
- Create: `src/app/docs/page.tsx`
- Create: `openapi.yaml`

- [ ] **Step 1: Install Swagger UI**

```bash
npm install swagger-ui-react @types/swagger-ui-react
```

- [ ] **Step 2: Create OpenAPI specification**

Create `openapi.yaml` at project root:

```yaml
openapi: 3.0.3
info:
  title: IVM — Intelligent Value Mapper API
  description: AI-powered document-to-form autofill platform
  version: 1.0.0

servers:
  - url: /api
    description: Main API

components:
  securitySchemes:
    session:
      type: apiKey
      in: cookie
      name: next-auth.session-token
  schemas:
    Error:
      type: object
      properties:
        error:
          type: string
        code:
          type: string
    SessionSummary:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        status:
          type: string
          enum: [CREATED, SOURCE_UPLOADED, EXTRACTED, TARGET_SET, MAPPED, FILLED, REVIEWED, COMPLETED, FAILED]
        currentStep:
          type: string
          enum: [SOURCE, EXTRACT, TARGET, MAP, FILL, REVIEW]
        createdAt:
          type: string
          format: date-time
    ExtractedField:
      type: object
      properties:
        id:
          type: string
        label:
          type: string
        value:
          type: string
        fieldType:
          type: string
          enum: [text, date, number, email, phone, address, name, currency, other]
        confidence:
          type: number
    TargetField:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        label:
          type: string
        fieldType:
          type: string
    FillAction:
      type: object
      properties:
        id:
          type: string
        targetFieldId:
          type: string
        targetLabel:
          type: string
        intendedValue:
          type: string
        appliedValue:
          type: string
          nullable: true
        verifiedValue:
          type: string
          nullable: true
        status:
          type: string
          enum: [PENDING, APPLIED, VERIFIED, FAILED, SKIPPED]

security:
  - session: []

paths:
  /sessions:
    get:
      summary: List user sessions
      tags: [Sessions]
      responses:
        "200":
          description: Session list
    post:
      summary: Create a new session
      tags: [Sessions]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [title]
              properties:
                title:
                  type: string
                description:
                  type: string
      responses:
        "201":
          description: Session created

  /sessions/{id}/upload:
    post:
      summary: Upload source document
      tags: [Source]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: File uploaded

  /sessions/{id}/extract:
    post:
      summary: Trigger AI extraction
      tags: [Extraction]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Extraction result or job queued

  /sessions/{id}/extraction:
    get:
      summary: Get extraction results
      tags: [Extraction]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Extraction data with fields

  /sessions/{id}/target:
    post:
      summary: Set target (URL or file upload)
      tags: [Target]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Target inspected
    get:
      summary: Get target info
      tags: [Target]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Target data
    delete:
      summary: Remove target
      tags: [Target]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Target removed

  /sessions/{id}/mapping:
    post:
      summary: Propose AI field mappings
      tags: [Mapping]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Proposed mappings
    get:
      summary: Get current mappings
      tags: [Mapping]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Mapping data

  /sessions/{id}/fill:
    post:
      summary: Execute fill
      tags: [Fill]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                skipFieldIds:
                  type: array
                  items:
                    type: string
                retryFieldIds:
                  type: array
                  items:
                    type: string
      responses:
        "200":
          description: Fill results
    get:
      summary: Get fill results
      tags: [Fill]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Fill data

  /sessions/{id}/fill/preview:
    get:
      summary: Preview fill values before execution
      tags: [Fill]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Preview data with intended values

  /sessions/{id}/fill/download:
    get:
      summary: Download filled document
      tags: [Fill]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Filled document binary

  /sessions/{id}/complete:
    post:
      summary: Mark session as completed
      tags: [Sessions]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Session completed

  /sessions/{id}/audit-events:
    get:
      summary: Get session audit events
      tags: [Audit]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        "200":
          description: Paginated audit events

  /sessions/{id}/export:
    get:
      summary: Export full session data as JSON
      tags: [Sessions]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Session JSON download

  /settings/api-keys:
    get:
      summary: List configured API keys
      tags: [Settings]
      responses:
        "200":
          description: Key list (prefixes only)
    post:
      summary: Add/update an API key
      tags: [Settings]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [provider, apiKey]
              properties:
                provider:
                  type: string
                  enum: [anthropic, openai, gemini]
                apiKey:
                  type: string
      responses:
        "200":
          description: Key saved

  /health:
    get:
      summary: Health check
      tags: [System]
      security: []
      responses:
        "200":
          description: System healthy
        "503":
          description: System unhealthy

  /metrics:
    get:
      summary: Prometheus metrics
      tags: [System]
      security: []
      responses:
        "200":
          description: Prometheus text format
```

- [ ] **Step 3: Create API spec serving route**

Create `src/app/api/docs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const specPath = path.join(process.cwd(), "openapi.yaml");
  const spec = fs.readFileSync(specPath, "utf-8");
  return new Response(spec, {
    headers: { "Content-Type": "text/yaml" },
  });
}
```

- [ ] **Step 4: Create Swagger UI page**

Create `src/app/docs/page.tsx`:

```typescript
"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <SwaggerUI url="/api/docs" />
    </div>
  );
}
```

- [ ] **Step 5: Exclude docs page from auth middleware**

In `middleware.ts`, update the matcher to exclude the docs route. Update the matcher pattern:

```typescript
export const config = {
  matcher: [
    "/((?!api/auth/(?!register)|api/health|api/metrics|api/docs|docs|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

- [ ] **Step 6: Commit**

```bash
git add openapi.yaml src/app/api/docs/route.ts src/app/docs/page.tsx middleware.ts package.json package-lock.json
git commit -m "feat: add OpenAPI documentation with Swagger UI"
```

---

## Execution Order

**Sequential dependency chain:**
1. **Task 1** (Redis) — foundational, required by Task 8
2. **Task 2** (S3) — independent, can run in parallel with Tasks 3-7
3. **Task 3** (DOCX extraction) — independent
4. **Task 4** (DOCX normalization) — independent
5. **Task 5** (Partial re-fill) — independent
6. **Task 6** (Fill preview) — independent
7. **Task 7** (Nonce CSP) — independent
8. **Task 8** (BullMQ) — depends on Task 1 (Redis)
9. **Task 9** (Sentry) — independent
10. **Task 10** (Prometheus) — independent
11. **Task 11** (OpenAPI) — independent, best done last since it documents final API shape

**Parallelizable groups:**
- Group A (after Task 1): Tasks 2, 3, 4, 5, 6, 7 — all independent
- Group B (after Group A): Task 8 — needs Redis from Task 1
- Group C (after all features): Tasks 9, 10, 11 — observability and docs

## Environment Variables Summary

New env vars added by Phase 8:

| Variable | Required | Default | Task |
|----------|----------|---------|------|
| `REDIS_URL` | No | (none — falls back to in-memory) | 1 |
| `S3_BUCKET` | No (required if `STORAGE_PROVIDER=s3`) | — | 2 |
| `S3_REGION` | No | `ap-southeast-1` | 2 |
| `S3_ACCESS_KEY_ID` | No | (uses AWS default chain) | 2 |
| `S3_SECRET_ACCESS_KEY` | No | (uses AWS default chain) | 2 |
| `S3_ENDPOINT` | No | (AWS default) | 2 |
| `SENTRY_DSN` | No | (Sentry disabled) | 9 |
| `NEXT_PUBLIC_SENTRY_DSN` | No | (client Sentry disabled) | 9 |
| `METRICS_TOKEN` | No | (metrics unprotected) | 10 |

## CLAUDE.md Updates

After completing Phase 8, update the Phase Status table:

```
| 8 | Deferred Features | Deployed |
```

Add to Architecture Patterns section:
- **Redis**: Optional — `REDIS_URL` enables persistent rate limiting and BullMQ job queue. Falls back to in-memory when not configured.
- **Background Queue**: BullMQ extraction queue auto-starts when Redis is available. Extract route returns immediately with `async: true`. Client polls `GET /extraction` for completion (existing behavior).
- **DOCX Source Extraction**: mammoth extracts text → sent to AI as text-only prompt (no binary content blocks). All three providers support this path.
- **DOCX Run Normalization**: `normalizeDocxRuns()` in `src/lib/fill/docx-normalize.ts` merges split `<w:r>` elements before placeholder search.
- **Partial Re-fill**: POST to fill with `{ retryFieldIds: [...] }` re-runs only failed fields, preserves successful ones.
- **Fill Preview**: `GET /api/sessions/[id]/fill/preview` returns intended values without executing.
- **Metrics**: Prometheus at `GET /api/metrics`, protected by optional `METRICS_TOKEN` bearer auth.
- **API Docs**: Swagger UI at `/docs`, OpenAPI spec at `/api/docs`.
