# IVM — Intelligent Value Mapper

AI-powered document-to-form autofill platform. Users upload a source document, AI extracts fields, selects a target (webpage/PDF/DOCX), AI maps fields, system fills and verifies, user reviews before final action.

## Tech Stack

- **Framework**: Next.js 15 (App Router) + TypeScript strict
- **Database**: PostgreSQL 16 via Prisma ORM (pinned to v6.x)
- **Styling**: Tailwind CSS v4 with `@theme inline` + CSS custom properties (RGB channel values)
- **UI**: Radix UI primitives, shadcn-style component pattern
- **Auth**: NextAuth v5 (`next-auth@beta`), JWT strategy, Credentials + GitHub OAuth
- **Logging**: Pino (pino-pretty in dev, JSON in prod)
- **Storage**: Abstracted via `StorageAdapter` interface (local/S3)
- **AI**: Multi-provider BYOK — Anthropic Claude, OpenAI GPT-4o, Google Gemini 2.0 Flash
- **Browser automation**: Playwright (Chromium, headless, BullMQ workers only)
- **Job queues**: BullMQ + Redis 7 (extraction, portal scrape, item detail)
- **Dev infra**: Docker Compose (PostgreSQL 16 + Redis 7)

## Critical Constraints

### Prisma v6 — Do NOT upgrade to v7
Prisma 7 removed `url` from schema datasource. Our `prisma/schema.prisma` uses `url = env("DATABASE_URL")` which is v6 syntax. Upgrading requires migrating to `prisma.config.ts` — planned task only.

### NextAuth v5 beta
Install as `next-auth@beta`, not `next-auth@5`. The session model is named `AuthSession` in Prisma to avoid conflict with `FillSession`.

### BYOK API Key Storage
User API keys encrypted with AES-256-GCM (`src/lib/crypto.ts`) using `ENCRYPTION_KEY` env var (32-byte hex). `UserApiKey` model has `@@unique([userId, provider])` — upsert semantics. Never store plaintext keys; always use `encrypt()`/`decrypt()`. Provider + key resolved via `resolveProviderAndKey()`, falling back to system `ANTHROPIC_API_KEY`.

### CSS Variables with RGB Channels
All color tokens in `src/styles/tokens.css` use RGB channel values (e.g., `--background: 255 255 255`) so Tailwind opacity modifiers work (e.g., `bg-background/50`). Never use hex values in token definitions.

## Architecture Patterns

### API Routes
- Use `errorResponse()` from `@/lib/errors` in catch blocks
- Throw `UnauthorizedError`, `NotFoundError`, `ValidationError` — not manual `NextResponse.json` errors
- Use `updateMany`/`deleteMany` with ownership `where` clause for PATCH/DELETE (avoids TOCTOU)

### Session Data Model
- Product sessions are `FillSession` (not `Session` — that's NextAuth's)
- Steps: `SOURCE → EXTRACT → TARGET → MAP → FILL → REVIEW`
- Step metadata in `src/types/session.ts`: `SESSION_STEPS`, `STEP_LABELS`, `STEP_ROUTES`, `STEP_DESCRIPTIONS`

### Storage
- Always use `getStorageAdapter()` from `@/lib/storage` — cached singleton
- Never hardcode `fs` operations

### AI Extraction (BYOK Multi-Provider)
- Entry point: `extractFieldsFromDocument()` from `src/lib/ai/index.ts`
- Adapters: `src/lib/ai/anthropic.ts`, `openai.ts`, `gemini.ts`
- Shared parser: `src/lib/ai/parse.ts` — all providers return same JSON format
- Prompts: `src/lib/ai/prompts.ts`; Types: `src/lib/ai/types.ts`
- Key validation: `src/lib/ai/validate-key.ts` (minimal API call before saving)
- Images → base64 content blocks; PDFs → base64 document blocks; DOCX → graceful error

### AI Field Mapping
- Entry point: `proposeFieldMappings()` from `src/lib/ai/mapping.ts` (text-only, no file uploads)
- Parser: `src/lib/ai/parse-mapping.ts` — validates response, adds unmapped fields the AI missed
- `FieldMapping.sourceFieldId` is nullable — `null` means no source match
- `MappingSet` lifecycle: `PROPOSED → ACCEPTED`

### Fill Execution
- Fillers: `src/lib/fill/pdf-filler.ts`, `docx-filler.ts`, `webpage-filler.ts`
- Dispatcher: `executeFill()` from `src/lib/fill/index.ts`
- Webpage fills: JS snippet delivered via clipboard copy, bookmarklet, or Chrome Extension
- Chrome Extension: `extension/` directory, Manifest V3. Set `NEXT_PUBLIC_IVM_EXTENSION_ID` after loading unpacked.
- DOCX caveat: placeholders split across XML runs will fail — must be contiguous `{{placeholder}}`

### Prisma JSON Fields
Wrap typed arrays/objects with `JSON.parse(JSON.stringify(...))` to satisfy `InputJsonValue`.

### Shared Types — Never Redeclare Inline
- `src/types/extraction.ts` — `ExtractedField`, `ExtractionState`, `SourceAssetData`
- `src/types/target.ts` — `TargetType`, `TargetField`, `TargetAssetData`
- `src/types/mapping.ts` — `FieldMapping`, `MappingState`
- `src/types/fill.ts` — `FillActionSummary`, `FillReport`, helpers
- `src/types/audit.ts` — `AuditEventSummary`, display helpers
- `src/types/session.ts` — `SessionSummary`, `SessionDetailSummary`
- `src/types/portal.ts` — `TrackedItemStatus`, `ComparisonFieldStatus`, `COMPARISON_FIELD_STATUSES`, `FieldComparison`, `ComparisonResultSummary`, selector types

### Shared Utilities (`src/lib/utils.ts`)
- `cn()` — className merging; `formatDate()` — en-SG locale; `sanitizeFileName()`, `formatFieldLabel()`, `confidenceVariant()`

### RSC Serialization — Lucide Icons
Never pass Lucide icon components as props from Server → Client Components (functions don't serialize). Pass pre-rendered `<Icon />` JSX instead. `EmptyState` accepts `icon` as `React.ReactNode`.

### Production Hardening
- **Env validation**: `src/lib/env.ts` — Zod schema, imported by `db.ts` for fail-fast
- **Rate limiting**: `src/lib/rate-limit.ts` — `globalLimiter` (100/min IP), `authLimiter` (10/min IP), `aiLimiter` (5/min user)
- **Retry**: `src/lib/retry.ts` — `withRetry()` with exponential backoff, max 2 retries on 429/5xx
- **AI timeouts**: 60s extraction, 30s mapping, 15s key validation
- **Health check**: `GET /api/health` — pings DB + Redis; excluded from auth middleware

### Portal Tracker (RPA + Comparison Engine)
- **Purpose**: Scrape authenticated portals, download files, AI-compare portal data vs PDF data
- **Browser automation**: Playwright in BullMQ workers only. Singleton browser via `src/lib/playwright/browser.ts`
- **Auth**: Cookie injection (Chrome Extension capture) or credential login. `resolveAuth()` tries cookies first
- **Cookie capture**: Extension popup POSTs to `/api/extension/cookies` → matched to portal by URL domain → saved via `portalCredential.upsert`
- **Extension messaging**: Content script bridge on IVM pages (`content.js`) is primary path. External `chrome.runtime.sendMessage` with retry is fallback. MV3 service workers terminate after ~30s — handled by retry
- **AI page analysis**: `analyzePageStructure()` — screenshot + HTML → CSS selectors. Uses `page.waitForFunction()` for SPA render (body text > 200 chars or rows present) + 2s settle before screenshot
- **Scrape queue**: `portal-scrape-queue.ts` — concurrency 1, no retry
- **Detail queue**: `item-detail-queue.ts` — concurrency 3, 2 attempts, 5min lock, startup recovery for PROCESSING items stuck from crashes
- **Session actions**: Stop (CANCELLED + drains BullMQ jobs), Delete (cascade), Retry failed, Continue unprocessed. Stop button shows whenever `inFlight > 0` (PROCESSING or DISCOVERED items exist) — not gated on sessionStatus. Resume (reprocess) from CANCELLED resets session back to COMPLETED.
- **Auto-retry on error**: `SessionActions` auto-calls `reprocess("failed")` once via `useEffect` when `counts.ERROR > 0` and `inFlight === 0`. Guards: `useRef` (per mount) + `sessionStorage` key per session (survives auto-refresh reloads).
- **Session items page**: fetches `detailData` + `comparisonResult` (including `fieldComparisons`) for up to 50 items. `TrackedItemsTable` renders expandable rows — click to see all data, files, and comparison inline. No horizontal scroll.
- **Prisma models**: `Portal`, `PortalCredential`, `ScrapeSession`, `TrackedItem`, `TrackedItemFile`, `ComparisonResult`
- **Types/Validations**: `src/types/portal.ts`, `src/lib/validations/portal.ts` — all selector fields `.optional().nullable()`
- **Status colors**: `ITEM_STATUS_COLORS` exported from `src/components/portals/portal-status-badge.tsx`

### Scraper — File Downloads
- **Primary method**: `page.request.get(href)` — inherits session cookies, works for inline PDFs and new-tab links that never trigger a browser download event
- **Parallel**: All href-based links fetched concurrently via `Promise.allSettled()`; `javascript:` / onclick fallback runs sequentially after (clicking navigates the page)
- **tmpDir**: Created lazily — only when there are `javascript:` links; skipped entirely for href-only pages
- **Click+download fallback**: Only for links with no navigable `href`. Uses `page.waitForEvent("download")` — will silently fail if portal serves file inline

### Scraper — Selector Timeout Debugging
- `waitForSelector(tableSelector, { timeout: 30_000 })` — 30s timeout (increased from 15s)
- On timeout, logs current page URL — check if redirected to login (cookies invalid) vs table just slow to render
- If URL ≠ expected portal URL after navigation, cookies are not authenticating — re-capture via Chrome Extension

### Deployment Guard (Stale Server Actions)
- `src/components/deployment-guard.tsx` — client component in root layout
- Listens for `"Failed to find Server Action"` errors (happen after redeploy when browser has old JS)
- Auto-reloads once per 30s via `sessionStorage` guard to prevent reload loops
- Without this, server action calls silently fail after deployment (e.g. file uploads appear to vanish)

### Scraper — SPA Gotchas
- **SPA row wait**: After `waitForSelector(tableSelector)`, call `waitForFunction(() => document.querySelectorAll('tbody tr').length > 0)` — SPA tables render shell first, data loads async
- **Click-discovery**: When no `detailLinkSelector` and no `href` links, detect `cursor:pointer` rows → Phase 1: extract data; Phase 2 (post-loop): click first row, wait for URL change via `waitForFunction((orig) => location.href !== orig)`, extract URL pattern, apply to all rows, `goBack()`
- **SPA navigation**: Use `waitForFunction((orig) => location.href !== orig, currentUrl)` — NOT `waitForNavigation()` (SPA routing doesn't fire navigation events)

## Deployment

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **SSH**: `ssh -i /c/Users/huien/.ssh/id_ed25519 root@72.62.75.247`
- **Database**: Supabase PostgreSQL in Docker on port 5433
- **Login**: `dev@ivm.local / password123`
- **Deploy**: `tar czf` locally → `scp` → `tar xzf` on VPS (bracket filenames break plain `scp`) → `npm run build && pm2 restart ivm`
- **Full deploy**: add `npm ci && npx prisma generate` before build

### PM2 Processes

| PM2 Name | Purpose |
|----------|---------|
| `ivm` | Next.js web server (port 3001) |
| `ivm-worker` | BullMQ portal list scraper |
| `ivm-detail-worker` | BullMQ item detail processor |

Workers source `.env` before running tsx — required because tsx doesn't auto-load `.env`.

```bash
pm2 list
pm2 restart ivm ivm-worker ivm-detail-worker
pm2 logs ivm-detail-worker --lines 50
pm2 save  # persist across reboots
```

If workers missing after reboot:
```bash
pm2 start scripts/start-worker.sh --name ivm-worker
pm2 start scripts/start-detail-worker.sh --name ivm-detail-worker
pm2 save
```

## Development Setup

```bash
cp .env.example .env        # set NEXTAUTH_SECRET and ENCRYPTION_KEY
docker compose up -d         # PostgreSQL + Redis
npx prisma generate
npx prisma migrate dev
npx prisma db seed           # dev@ivm.local / password123
npm run dev                  # http://localhost:3000
```

Generate `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## File Organization

```
src/
  app/(auth)/               # Sign-in, sign-up
  app/(dashboard)/          # Protected pages
  app/api/                  # API routes
  components/ui/            # Reusable primitives
  components/sessions/      # Fill session components
  components/portals/       # Portal Tracker components
  components/settings/      # Settings components
  lib/ai/                   # Multi-provider AI (extraction, mapping, comparison)
  lib/playwright/           # Browser automation (browser, auth, scraper)
  lib/queue/                # BullMQ queues + scheduler
  lib/fill/                 # Fill engines (PDF/DOCX/webpage)
  lib/target/               # Target inspection (webpage/PDF/DOCX)
  lib/storage/              # Storage adapter
  lib/validations/          # Zod schemas
  types/                    # Shared TypeScript types
  styles/                   # CSS tokens
prisma/                     # Schema and seed
extension/                  # Chrome Extension (Manifest V3)
scripts/                    # VPS worker start scripts
```
