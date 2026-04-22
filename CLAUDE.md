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
- **AI**: Multi-provider BYOK — Anthropic Claude, OpenAI GPT-4o, Google Gemini 2.0 Flash, Azure AI Foundry (Claude via Azure)
- **Browser automation**: Playwright (Chromium, headless, BullMQ workers only)
- **Job queues**: BullMQ + Redis 7 (extraction, portal scrape, item detail)
- **Dev infra**: Docker Compose (PostgreSQL 16 + Redis 7)

## Critical Constraints

### Prisma v6 — Do NOT upgrade to v7
Prisma 7 removed `url` from schema datasource. Our `prisma/schema.prisma` uses `url = env("DATABASE_URL")` which is v6 syntax. Upgrading requires migrating to `prisma.config.ts` — planned task only.

### NextAuth v5 beta
Install as `next-auth@beta`, not `next-auth@5`. The session model is named `AuthSession` in Prisma to avoid conflict with `FillSession`.

### BYOK API Key Storage
User API keys encrypted with AES-256-GCM (`src/lib/crypto.ts`) using `ENCRYPTION_KEY` env var (32-byte hex). `UserApiKey` model has `@@unique([userId, provider])` — upsert semantics. Never store plaintext keys; always use `encrypt()`/`decrypt()`. Provider + key resolved via `resolveProviderAndKey()` with priority: 1) User BYOK keys, 2) CLI proxy (`CLAUDE_PROXY_URL` + `CLAUDE_PROXY_TOKEN`, sets `provider: "openai"` + `baseURL`), 3) system `ANTHROPIC_API_KEY` fallback.

### Azure AI Foundry Provider
Uses `@anthropic-ai/sdk` with `baseURL` override — no separate SDK. `UserApiKey.endpoint` stores per-user endpoint. Resolves as `provider: "azure-foundry"` (not `"openai"`). Proxy detection in `index.ts` and `page-analysis.ts` checks `provider === "openai"` to avoid misrouting Azure Foundry through the proxy Read-tool path. All AI routing files fall through `"azure-foundry"` to the Anthropic adapter. Validation uses `claude-haiku-4-5` with 15s timeout + 404 handling for bad endpoints.

**Endpoint format**: SDK appends `/v1/messages` to `baseURL` — Azure requires `/anthropic/` prefix:
- Correct: `https://<resource>.services.ai.azure.com/anthropic/`
- Wrong: `https://<resource>.services.ai.azure.com/api/projects/...`

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
- Always use `getStorageAdapter()` from `@/lib/storage` — cached singleton. Never hardcode `fs` operations.
- **Auto-cleanup** (`src/lib/storage/cleanup.ts`, runs every 24h): retention cleanup deletes `ScrapeSession` records older than `SCRAPE_RETENTION_DAYS` (default 7) + cascade; orphan cleanup removes disk files under `portal-files/` with no DB reference.

### AI Extraction (BYOK Multi-Provider)
- Entry point: `extractFieldsFromDocument()` from `src/lib/ai/index.ts`
- Adapters: `anthropic.ts`, `openai.ts`, `gemini.ts`, `proxy-extraction.ts`; shared parser: `parse.ts`
- Images → base64 content blocks; PDFs → base64 document blocks; DOCX → graceful error
- **`knownDocumentTypes?: string[]`** on `AIExtractionRequest` — injected into system prompt so AI picks from exact list. Pass `cachedDocTypes.map(dt => dt.name)` from the worker.

### AI Extraction — CLI Proxy Read-Tool Path
CLI-based proxies serialize messages to plain text — base64 content blocks are silently dropped. `proxy-extraction.ts` sends a text-only prompt telling Claude to use its **Read tool** instead.
- **Routing**: `index.ts` checks `baseURL && storagePath && !textContent` → `extractWithProxyReadTool()`
- **`storagePath`**: relative storage key resolved to absolute via `path.resolve(STORAGE_LOCAL_PATH, storagePath)`
- **Parser robustness**: `stripMarkdownFences()` tries strict then loose regex; `extractJsonObject()` fallback finds `{...}` containing `"documentType"` + `"fields"` in free-form agent responses

### AI Field Mapping
- Entry point: `proposeFieldMappings()` from `src/lib/ai/mapping.ts` (text-only)
- Parser: `parse-mapping.ts` — validates response, adds unmapped fields the AI missed
- `FieldMapping.sourceFieldId` is nullable — `null` means no source match; `MappingSet` lifecycle: `PROPOSED → ACCEPTED`

### Fill Execution
- Fillers: `pdf-filler.ts`, `docx-filler.ts`, `webpage-filler.ts`; dispatcher: `executeFill()` from `src/lib/fill/index.ts`
- Webpage fills: JS snippet via clipboard copy, bookmarklet, or Chrome Extension (`extension/`, Manifest V3)
- DOCX caveat: placeholders split across XML runs will fail — must be contiguous `{{placeholder}}`

### Shared Types — Never Redeclare Inline
- `src/types/extraction.ts` — `ExtractedField`, `ExtractionState`, `SourceAssetData`
- `src/types/target.ts` — `TargetType`, `TargetField`, `TargetAssetData`
- `src/types/mapping.ts` — `FieldMapping`, `MappingState`
- `src/types/fill.ts` — `FillActionSummary`, `FillReport`, helpers
- `src/types/portal.ts` — `TrackedItemStatus`, `ComparisonFieldStatus`, `COMPARISON_FIELD_STATUSES`, `FieldComparison`, `ComparisonResultSummary`, `ItemFile`, `ComparisonSummary`, `ValidationAlert`, `DiscoveredClaimType`, selector types, `ITEM_EVENT_TYPES`, `ItemEventType`, `ItemEventSummary`, `EVENT_TYPE_LABELS`, `EVENT_SEVERITY`, `FWA_PRIORITY`

### Shared Utilities (`src/lib/utils.ts`)
- `cn()`, `formatDate()` (en-SG), `sanitizeFileName()`, `formatFieldLabel()`, `confidenceVariant()`
- `toInputJson()` — strips `undefined` via JSON round-trip for Prisma `InputJsonValue`. Never use bare `JSON.parse(JSON.stringify(...))`.
- `toggleArrayItem<T>(arr, item)` — use for checkbox array state in portal doc type selectors

### RSC Serialization — Lucide Icons
Never pass Lucide icon components as props from Server → Client Components. Pass pre-rendered `<Icon />` JSX instead. `EmptyState` accepts `icon` as `React.ReactNode`.

### Production Hardening
- **Env validation**: `src/lib/env.ts` — Zod schema, fail-fast on startup
- **Rate limiting**: `globalLimiter` (100/min IP), `authLimiter` (10/min IP), `aiLimiter` (5/min user)
- **Retry**: `withRetry()` — exponential backoff, max 2 retries on 429/5xx
- **AI timeouts**: 180s extraction (streaming), 30s mapping, 15s key validation
- **Health check**: `GET /api/health` — pings DB + Redis; excluded from auth middleware

## Portal Tracker

### Core (RPA + Comparison Engine)
- Browser automation via Playwright in BullMQ workers only. Singleton browser: `src/lib/playwright/browser.ts`
- Auth: cookie injection (Chrome Extension capture) or credential login. `resolveAuth()` tries cookies first
- Cookie capture: Extension popup POSTs to `/api/extension/cookies` → matched by URL domain → `portalCredential.upsert`
- **Scrape queue**: `portal-scrape-queue.ts` — concurrency 1, no retry
- **Detail queue**: `item-detail-queue.ts` — concurrency 3, 2 attempts, 5min lock, startup recovery for stuck PROCESSING items
- **BullMQ job deduplication**: Uses stable `jobId: item_${trackedItemId}`. BullMQ silently drops `addBulk` entries whose jobId already exists. Always pass `{ reprocess: true }` to `enqueueItemDetailBatch` when re-enqueuing — it removes the old terminal job first. Never call without this flag for retry/continue flows.
- **isActive rule**: `AutoRefresh` renders only when `status === "RUNNING" | "PENDING"` OR `PROCESSING > 0`. Do NOT add `DISCOVERED > 0` — causes infinite spinner on stalled sessions.
- **Stable sort**: Items ordered by `[{ createdAt: "asc" }, { id: "asc" }]` — secondary `id` required as tiebreaker for batch-created items.
- **Stop button**: Shows only when `sessionStatus === "RUNNING"` OR `counts.PROCESSING > 0`.
- **Auto-retry**: `SessionActions` auto-calls `reprocess("failed")` once via `useEffect` when `counts.ERROR > 0`. Guards: `useRef` (per mount) + `sessionStorage` key per session.
- **Expanded row — 3-column layout** (`src/components/portals/expanded-row/`):
  - Column 1: Portal Details — `detailData` key-value with match indicators, falls back to `listData`, "Open in Portal" link
  - Column 2: Comparison & Alerts — field comparison table, match rate, AI summary, diagnosis pill, currency notices, FWA alerts. Grid `[0.8fr_2fr_1fr]`.
  - Column 3: Document Viewer — file selector chips, inline blob viewer (images with lightbox, PDFs via `blob:` URL to bypass X-Frame-Options)
  - PROCESSING/DISCOVERED: shows `ProcessingFeed` instead (polls `/events` every 3s)
- **Prisma models**: `Portal`, `PortalCredential`, `ScrapeSession`, `TrackedItem`, `TrackedItemFile`, `ComparisonResult`, `TrackedItemEvent`, `ComparisonConfig`, `ComparisonTemplate`, `ProviderGroup`

### Scrape Filters
`Portal.scrapeFilters` JSONB: `{ excludeByStatus: string[], excludeBySubmittedBy: string[] }`
- `excludeByStatus` — at **list scrape time** (`portal-worker.ts`): rows never written to `TrackedItem`
- `excludeBySubmittedBy` — at **detail scrape time** (`item-detail-worker.ts`): item **deleted** + `itemsFound` decremented. Do NOT add to portal-worker — field absent from list page.
- UI: `ScraperFiltersCard` with two tag-inputs. Migration: `20260421000000_add_scrape_filters`

### Comparison Configs & Templates
- Each portal can have multiple `ComparisonConfig` records with their own `groupingFields` and `ComparisonTemplate` records
- `Portal.groupingFields` synced from all configs (union) for backward compat
- **Match modes**: `fuzzy` (ignore formatting), `exact`, `numeric` (within tolerance)
- **Template lookup**: `findMatchingTemplate(portalId, itemData)` in `src/lib/comparison-templates.ts`, called before every AI comparison
- **Template field filtering**: passes ALL fields unfiltered — prompt size controlled via compact JSON in `prompt-builder.ts`
- **Prompt compaction**: single-line `JSON.stringify()`, PDF values truncated at 200 chars via `compactFields()`
- **Comparison prompt rules** (`prompts-comparison.ts`): principle-based, no hardcoded examples. `DIAGNOSIS_JSON_SCHEMA` and `DIAGNOSIS_RULES` exported + imported by `prompt-builder.ts` — never duplicate inline. Key rules: (1) ignore leading punctuation on IDs (`#C313875` = `C313875`); (2) semantic parent-brand matching for org names; (3) amounts differing 50x–100x noted as possible currency difference in `notes`
- **Diagnosis Assessment**: AI-produced `DiagnosisAssessment` in `ComparisonResult.diagnosisAssessment` (JSONB). Fields: `diagnosis`, `icdCode`, `source` (document/portal/inferred), `confidence`, `evidence`. Migration: `20260422100000_add_diagnosis_assessment`
- **Per-portal AI model override**: `Portal.comparisonModel String?` — overrides user's default for comparison. Options: `null`, `"claude-sonnet-4-6"`, `"claude-opus-4-6"`. Migration: `20260421200000_add_comparison_model`
- **Copy setup API**: `POST /api/portals/[id]/comparison-setup/import` — copies all configs + templates + provider groups in one transaction; remaps provider group IDs for FK integrity
- **Recompare API**: `POST .../recompare` with `{ templateId }` — re-runs AI comparison, replaces old `ComparisonResult`

### Provider Groups
`ProviderGroup`: `portalId`, `name`, `providerFieldName`, `matchMode` ("list" | "others"), `members` (JSONB).
- `list` — normalized substring fuzzy match. `others` — catch-all for unmatched providers.
- Matching priority: list groups → others fallback → templates without providerGroup → null (full comparison)
- `normalizeForMatch()`: lowercase, trim, collapse whitespace. `fuzzyMatchProvider()`: substring check both ways.
- Migration: `20260421100000_add_provider_groups`

### Field Discovery
- `discoverFields()` in `src/lib/portal-discovery.ts` — scrapes list page, visits ONE detail page per unique grouping combo, saves to `Portal.discoveredClaimTypes` (JSONB)
- API: `POST /api/portals/[id]/discover` with `{ groupingFields: string[] }`
- Type: `DiscoveredClaimType` — `{ groupingKey, detailFields, sampleUrl, discoveredAt }`

### Cross-Item Duplicate Detection
`runCrossItemChecks(sessionId)` in `src/lib/validations/cross-item.ts` — auto-detects date/patient fields via regex, groups by (patient + date), writes `ValidationResult` with `ruleType: "DUPLICATE"`. Fires when `itemsProcessed === itemsFound` (exact equality prevents duplicate runs). Fire-and-forget.

### Currency Detection Pipeline
`checkForeignCurrency(trackedItemId, pdfFields, portalData)` in `src/lib/validations/currency.ts`.
- **Critical**: Always pass `pdfRawFields` (built from `field.rawText ?? field.value`) — NOT `pdfFields` (numeric-only). `parseCurrencyAmount()` needs the original currency prefix (`PHP 56,280.50`) to match.
- Creates `CURRENCY_CONVERSION` `ValidationResult` with metadata (originalCurrency, originalAmount, sgdAmount, rate, rateDate, source, isFallback, isFuture).

### Inline Re-authentication
- Auth status computed client-side in `portal-detail-view.tsx` via `useEffect` (avoids SSR hydration mismatch)
- Inline re-auth panel expands below the 4-column grid on "Set up ↓" / "Update ↓"
- On save: panel closes, `router.refresh()`

### Item Event Observability
- `TrackedItemEvent`: 22 typed events in `ITEM_EVENT_TYPES` covering auth, scrape, download, AI extract/compare, item complete/error
- `AI_EXTRACT_TRUNCATED` → `"warning"` severity, emitted when extraction hits `max_tokens`
- Helpers: `emitItemEvent()`, `emitFailureEvent()`, `withEventTracking()` (wraps async fn with start/done/fail + timing)
- Screenshot API: path must start with `portal-events/{itemId}/` — validated before storage download
- UI: `item-event-timeline.tsx` auto-refreshes every 3s while PROCESSING/DISCOVERED; `ProcessingFeed` condensed variant in expanded row

### Scraper Details
- **File downloads**: Primary — `page.request.get(href)` (inherits cookies). `javascript:` onclick fallback sequential after. `tmpDir` created lazily only for `javascript:` links.
- **Garbage filtering**: `filterGarbageFields()` — removes entries where >50% of values are identical and count >5. `effectiveDetailData` pattern on retry: if new scrape returns <50% fields of existing, keeps old data.
- **Selector timeout**: 30s. On timeout, log current URL — redirected to login means cookies invalid.
- **SPA row wait**: After `waitForSelector`, call `waitForFunction(() => document.querySelectorAll('tbody tr').length > 0)` — SPA tables load data async.
- **SPA navigation**: Use `waitForFunction((orig) => location.href !== orig, currentUrl)` — NOT `waitForNavigation()`.
- **Click-discovery**: When no `detailLinkSelector` and no `href` links, detect `cursor:pointer` rows → click first row → wait for URL change → extract pattern → apply to all rows → `goBack()`.

### Intelligence (Background Pipeline — No UI)
Runs in `item-detail-worker.ts` only. No sidebar link, no management UI.
- `classifier.ts` — `fetchDocTypes(userId)`; `classifyDocumentTypeFromCache()` Jaro-Winkler fuzzy match
- `validator.ts` — `validateRequiredFields()`; `checkDocTypeMatch()` writes `DOC_TYPE_MATCH` ValidationResult
- `deduplicator.ts` — SHA-256 hash, 90-day lookback
- `tampering.ts` — compares hash against most recent previous scrape. **Ordering**: collect `tamperingTargets[]` during extraction loop; call `checkTampering` AFTER `deleteMany` that clears previous-attempt results — else TAMPERING results get immediately wiped.
- **FWA display**: `FWA_RULE_TYPES` (Set) + `FWA_LABELS` (Record) in `src/types/portal.ts`. Table row: single worst badge. Expanded row: all alerts.
- **Key constraint**: `ValidationResult` has no Prisma relation to `TrackedItem` (raw FK only) — query via `where: { trackedItemId }`, never `include`

### Deployment Guard (Stale Server Actions)
`src/components/deployment-guard.tsx` — listens for `"Failed to find Server Action"` errors, auto-reloads once per 30s via `sessionStorage` guard.

## Deployment

- **Azure VM**: `20.198.253.167`, Ubuntu 24.04, 8GB RAM
- **SSH**: `ssh -i /c/Users/huien/Downloads/ivm-vm_key.pem azureuser@20.198.253.167`
- **App URL**: `http://20.198.253.167`
- **Database**: PostgreSQL on port 5432 (standard, no Docker wrapper)

### Environment: `/etc/ivm/.env`
Production env vars live in `/etc/ivm/.env` — never overwritten by deploys. `/var/www/ivm/.env` is a symlink to it (recreated by deploy script). To edit: `nano /etc/ivm/.env` then `pm2 restart ivm --update-env`.

### Deploy
```bash
bash scripts/deploy.sh
```
Tars source → SCPs to Azure VM → re-creates `.env` symlink → `npm ci --omit=dev` → `prisma generate` → `prisma migrate deploy` → stops workers → `npm run build` → `pm2 restart ivm ivm-worker ivm-detail-worker` → health check.

### PM2 Processes

| Name | Purpose | Start |
|------|---------|-------|
| `ivm` | Next.js web (port 3001) | `/etc/ivm/start-app.sh` |
| `ivm-worker` | BullMQ portal list scraper | `scripts/start-worker.sh` |
| `ivm-detail-worker` | BullMQ item detail processor | `scripts/start-detail-worker.sh` |

All start scripts source `/etc/ivm/.env` before running — tsx/node don't auto-load `.env`.

```bash
pm2 list && pm2 logs ivm-detail-worker --lines 50
pm2 restart ivm ivm-worker ivm-detail-worker && pm2 save
```

## Development Setup

```bash
cp .env.example .env        # set NEXTAUTH_SECRET and ENCRYPTION_KEY
docker compose up -d         # PostgreSQL + Redis
npx prisma generate && npx prisma migrate dev && npx prisma db seed
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
    expanded-row/           # 3-column expandable detail row sub-components
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
scripts/                    # Azure VM worker start scripts + deploy
```
