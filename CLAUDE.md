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
- `src/types/portal.ts` — `TrackedItemStatus`, `ComparisonFieldStatus`, `COMPARISON_FIELD_STATUSES`, `FieldComparison`, `ComparisonResultSummary`, selector types, `ITEM_EVENT_TYPES`, `ItemEventType`, `ItemEventSummary`, `EVENT_TYPE_LABELS`, `EVENT_SEVERITY`

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
- **Session actions**: Stop (CANCELLED + drains BullMQ jobs), Delete (cascade), Retry failed, Continue unprocessed. Stop button shows only when `sessionStatus === "RUNNING"` OR `counts.PROCESSING > 0` — not shown for already-cancelled sessions with only DISCOVERED items queued. Resume (reprocess) from CANCELLED resets session back to COMPLETED.
- **Auto-retry on error**: `SessionActions` auto-calls `reprocess("failed")` once via `useEffect` when `counts.ERROR > 0` and `inFlight === 0`. Guards: `useRef` (per mount) + `sessionStorage` key per session (survives auto-refresh reloads).
- **Session items page**: fetches `detailData` + `comparisonResult` (including `fieldComparisons`) for up to 50 items. `TrackedItemsTable` renders expandable rows — click to see all data, files, comparison, and processing timeline inline. No horizontal scroll.
- **Prisma models**: `Portal`, `PortalCredential`, `ScrapeSession`, `TrackedItem`, `TrackedItemFile`, `ComparisonResult`, `TrackedItemEvent`, `ComparisonTemplate`
- **Types/Validations**: `src/types/portal.ts`, `src/lib/validations/portal.ts` — all selector fields `.optional().nullable()`
- **Status colors**: `ITEM_STATUS_COLORS` exported from `src/components/portals/portal-status-badge.tsx`

### Portal Tracker — Comparison Templates
- **Purpose**: Per-claim-type field selection + match rules so AI comparison is focused instead of comparing all fields
- **Grouping fields**: Portal-level `groupingFields: string[]` — which scraped fields identify a "claim type" (e.g. `["Claim Type", "Payer"]`). Configured via `GroupingFieldConfig` on portal detail page.
- **Template model**: `ComparisonTemplate` — `portalId`, `name`, `groupingKey` (JSONB, e.g. `{"Claim Type": "Inpatient"}`), `fields` (JSONB array of `{fieldName, mode, tolerance?}`)
- **Match modes**: `fuzzy` (default, ignore formatting), `exact` (any difference = mismatch), `numeric` (numeric within tolerance)
- **Template lookup**: `findMatchingTemplate(portalId, itemData)` in `src/lib/comparison-templates.ts` — fetches portal groupingFields + all templates, matches by case-insensitive key comparison. Worker calls this before every AI comparison.
- **Template field filtering**: `filterFieldsByTemplate` only filters `pageFields` (portal fields) by template field names. `pdfFields` are passed through unfiltered — PDF field labels are document-native (e.g. "Inv. No.", "Patient Name") and must be semantically matched by the AI, not pre-filtered by portal field names. Filtering pdfFields would discard all PDF data before comparison.
- **Fallback**: If no grouping fields configured or no template matches, falls back to full AI comparison (all fields, no mode rules)
- **Inline prompt flow**: After a session completes, `SessionActions` fetches `/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types` — items that used full comparison with no template. Prompts user to configure a template via `ComparisonTemplateModal`. On save, calls recompare API.
- **Recompare API**: `POST .../recompare` with `{ templateId }` — re-runs AI comparison on matching items using template rules, replaces old `ComparisonResult`
- **Template UI**: `GroupingFieldConfig` (set grouping fields), `TemplateList` (view/delete templates), `ComparisonTemplateModal` (configure new template inline) — all on portal detail page or session actions
- **Item detail view**: Shows template name badge or "Full comparison" badge alongside provider on the comparison result card
- **Key helper**: `itemMatchesGroupingKey(groupingFields, itemData, templateKey)` — pure function, used in both template matching and recompare filtering
- **Copy setup API**: `POST /api/portals/[id]/comparison-setup/import` with `{ sourcePortalId }` — copies `groupingFields` + all `ComparisonTemplate` records from source portal in a single transaction; deletes existing templates on target first. Both portals must belong to the same user.
- **Copy setup UI**: "Copy from portal" ghost button in Comparison Setup card header → fetches portal list → select source → import. Auto-refreshes on success.

### Portal Tracker — Inline Re-authentication
- **Problem**: Cookie-based auth expires; previously required navigating away to re-configure.
- **Auth status detection**: `useEffect` in `portal-detail-view.tsx` computes `AuthStatus` (`ok | warn | expired | missing`) client-side to avoid SSR hydration mismatch with `new Date()` comparisons.
- **Visual indicators**: Auth card gets colored ring + colored Shield icon + status text. Red banner at page top when `expired` or `missing` with "Update auth" shortcut button.
- **Inline re-auth panel**: Clicking "Set up ↓" / "Update ↓" on the auth card expands a full-width card below the 4-column grid:
  - COOKIES auth: textarea for JSON cookie array paste (same format as `saveCookiesSchema`) → `POST /api/portals/{id}/cookies`
  - CREDENTIALS auth: username + password inputs → `POST /api/portals/{id}/credentials`
- On save: panel closes, `router.refresh()` re-fetches fresh auth status.

### Portal Tracker — Item Event Observability
- **Purpose**: Per-item structured event log for self-diagnosing scrape failures from the UI (no SSH needed)
- **Model**: `TrackedItemEvent` — `id`, `trackedItemId`, `eventType`, `payload` (JSONB), `screenshotPath`, `durationMs`, `createdAt`; indexed on `(trackedItemId, createdAt)`
- **Event types**: defined in `src/types/portal.ts` as `ITEM_EVENT_TYPES` const — 21 typed events covering AUTH_START/SUCCESS/FAIL, DETAIL_SCRAPE_START/DONE/FAIL, SELECTOR_MATCH, DOWNLOAD_START/DONE, AI_EXTRACT_START/DONE/FAIL, AI_COMPARE_START/DONE/FAIL, ITEM_COMPLETE, ITEM_ERROR
- **Emission helpers** (`src/lib/portal-events.ts`):
  - `emitItemEvent(trackedItemId, eventType, payload?, options?)` — fire-and-forget, never throws
  - `emitFailureEvent(trackedItemId, eventType, error, screenshot?)` — uploads screenshot buffer to StorageAdapter at `portal-events/{itemId}/{timestamp}.png`, stores path
  - `withEventTracking(trackedItemId, startType, doneType, failType, payload, fn, captureScreenshot?)` — wraps async fn, emits start/done/fail + timing automatically
- **Worker instrumentation**: `item-detail-worker.ts` emits events at every stage; outer catch captures page screenshot if browser still open
- **API routes**: `GET .../items/:id/events` (list), `GET .../items/:id/events/screenshot?path=...` (serve PNG, path must start with `portal-events/{itemId}/` to prevent traversal)
- **Timeline UI**: `src/components/portals/item-event-timeline.tsx` — auto-refreshes every 3s while PROCESSING/DISCOVERED; colored dots (red/green/grey), expandable payload, screenshot lightbox; rendered inside expanded rows of `TrackedItemsTable`
- **Screenshot path validation**: `screenshotPath` must start with `portal-events/{itemId}/` — validated in screenshot API route before storage download

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

### Intelligence (Monitoring Only)
- **Purpose**: Document classification, validation monitoring, and analytics. Phases 2-4 (Reference Data, Mapping Rules, Business Rules, Extraction Config) had UI/APIs removed — Prisma models remain in schema but are unused.
- **Portal Tracker only**: All intelligence features run in Portal Tracker scrape sessions only. Auto Form has no intelligence integration.
- **Sidebar**: Brain icon → `/intelligence` hub page with 3 cards: Document Types, Dashboard, Validation History
- **Migrations**: `20260410200000_add_intelligence_hub` (all tables), `20260411000000_add_expected_doc_type_to_scrape_session`, `20260413100000_add_default_doc_type_to_portal`

#### Document Classification (Types)
- **Page**: `/intelligence/document-types` — renders `DocumentTypeList` directly
- **Prisma models**: `DocumentType`, `ValidationResult` (trackedItemId?, ruleType, status PASS/FAIL/WARNING, message, metadata JSON)
- **ScrapeSession fields**: `expectedDocumentTypeId?` — set at scrape creation via modal (optional, pre-selected from portal default)
- **Portal default**: `Portal.defaultDocumentTypeId` — optional FK to `DocumentType`, configurable via dropdown card on portal detail page. `ScrapeSessionModal` pre-selects this value.
- **API routes**: `GET/POST /api/intelligence/document-types`, `PATCH/DELETE /api/intelligence/document-types/[id]`
- **Validation API**: `GET /api/portals/[id]/scrape/[sessionId]/items/[itemId]/validations`
- **Runtime lib** (`src/lib/intelligence/`):
  - `classifier.ts` — `fetchDocTypes(userId)` pre-fetches once; `classifyDocumentTypeFromCache(aiDocType, docTypes)` pure Jaro-Winkler fuzzy match on name + aliases
  - `validator.ts` — `validateRequiredFields(docType, extractedFields, options)` checks required field names; `checkDocTypeMatch(classifiedTypeId, classifiedTypeName, expectedTypeId, expectedTypeName, options)` persists `DOC_TYPE_MATCH` FAIL/WARNING when classified type differs from expected
  - `deduplicator.ts` — `checkDuplicate(userId, documentTypeId, keyFields, extractedFields, options)` SHA-256 hashes key field values, 90-day lookback
- **Worker integration** (`item-detail-worker.ts`): Non-fatal pipeline — classify → validate required fields → check duplicate → check doc type match (once per item, after file loop, uses first classified file). Never blocks comparison pipeline.
- **Doc type mismatch badge**: After processing, if `scrapeSession.expectedDocumentTypeId` is set and the downloaded PDF was classified as a different type (or couldn't be classified), a `ValidationResult` with `ruleType: "DOC_TYPE_MATCH"` is written. Status `"FAIL"` = wrong type; `"WARNING"` = unrecognised type.
- **FWA display constants**: `FWA_RULE_TYPES` (Set) and `FWA_LABELS` (Record) in `src/types/portal.ts` — shared by `TrackedItemsTable` and `ItemDetailView`. Adding a new alert type requires updating only this one location.
- **Session items table**: DOC_TYPE_MATCH surfaces as a red/amber "Wrong Doc Type" badge in the FWA column alongside Tampering/Anomaly/etc. Tooltip shows the mismatch message.
- **Key constraint**: `ValidationResult` has no `userId` — always scope queries via trackedItemId→TrackedItem→ScrapeSession→Portal.userId
- **Item detail view**: Validation results displayed below comparison result card when present (PASS/FAIL/WARNING icons + rule type badge)

#### Dashboard
- **Page**: `/intelligence/dashboard` — 2 stat cards (Document Types, Validations 7d), recent validation list, getting-started empty state

#### Validation History (Audit)
- **Page**: `/intelligence/audit` — shows recent `ValidationResult` records scoped to user's tracked items (Portal Tracker only), ordered newest first
- **API**: `GET /api/intelligence/audit` — trackedItem-scoped with pagination (?page, ?limit)

## Deployment

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **SSH**: `ssh -i /c/Users/huien/.ssh/id_ed25519 root@72.62.75.247`
- **Database**: Supabase PostgreSQL in Docker on port **5433** (NOT 5432)
- **Login**: `dev@ivm.local / password123`
- **Database name**: `ivm` (NOT `ivm_dev`) — correct `DATABASE_URL`:
  ```
  DATABASE_URL="postgresql://ivm:ivm_dev_password@localhost:5433/ivm?schema=public"
  ```

### Environment Source of Truth: `/etc/ivm/.env`

All production env vars live in **`/etc/ivm/.env`** — outside the deploy directory, never overwritten by deploys.

- `/var/www/ivm/.env` is a **symlink** → `/etc/ivm/.env`. The deploy script recreates this symlink after every extraction.
- To edit production env: `nano /etc/ivm/.env` then `pm2 restart ivm --update-env`
- **Never** edit `/var/www/ivm/.env` directly — it's just a symlink.

### Deploy

Use `scripts/deploy.sh` — it handles tar (excluding `.env`), upload, extraction, symlink restore, build, and restart:

```bash
bash scripts/deploy.sh
```

The script:
1. Tars source (excludes `.env`, `node_modules`, `.next`, `uploads`)
2. SCPs to VPS → extracts
3. Re-creates `.env` symlink → `/etc/ivm/.env`
4. Validates DATABASE_URL has correct port/db before proceeding
5. `npm ci` → `prisma generate` → `prisma migrate deploy` → `npm run build`
6. `pm2 restart ivm ivm-worker ivm-detail-worker`
7. Hits health check to confirm

**Never manually tar + deploy without `--exclude=.env`** — that was the historical cause of port 5432/ivm_dev overwrite bugs.

- **Schema migrations**: `prisma migrate deploy` requires `DATABASE_URL` pointing to port 5433. If the `ivm` user lacks DDL privileges, run migration SQL directly: `docker exec supabase-db psql -U postgres -d ivm -f migration.sql`, then insert into `_prisma_migrations` manually

### PM2 Processes

| PM2 Name | Purpose | Start script |
|----------|---------|--------------|
| `ivm` | Next.js web server (port 3001) | `/etc/ivm/start-app.sh` |
| `ivm-worker` | BullMQ portal list scraper | `scripts/start-worker.sh` |
| `ivm-detail-worker` | BullMQ item detail processor | `scripts/start-detail-worker.sh` |

All start scripts source `/etc/ivm/.env` (or `/var/www/ivm/.env` symlink) before running — required because tsx/node don't auto-load `.env`.

```bash
pm2 list
pm2 restart ivm ivm-worker ivm-detail-worker
pm2 logs ivm-detail-worker --lines 50
pm2 save  # persist across reboots
```

If processes missing after reboot:
```bash
pm2 start /etc/ivm/start-app.sh --name ivm
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
