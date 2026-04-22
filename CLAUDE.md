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
User API keys encrypted with AES-256-GCM (`src/lib/crypto.ts`) using `ENCRYPTION_KEY` env var (32-byte hex). `UserApiKey` model has `@@unique([userId, provider])` — upsert semantics. Never store plaintext keys; always use `encrypt()`/`decrypt()`. Provider + key resolved via `resolveProviderAndKey()` with priority: 1) User BYOK keys, 2) CLI proxy (`CLAUDE_PROXY_URL` + `CLAUDE_PROXY_TOKEN`, sets `provider: "openai"` + `baseURL`), 3) system `ANTHROPIC_API_KEY` fallback. CLI proxy uses Claude subscription quota — OAuth tokens cannot call the Anthropic Messages API directly, so file extraction goes through the Read-tool path (see below).

### Azure AI Foundry Provider
Azure AI Foundry exposes Claude models via the native Anthropic Messages API at a custom endpoint URL. Uses the same `@anthropic-ai/sdk` with `baseURL` override — no separate SDK. `UserApiKey.endpoint` (nullable) stores the per-user endpoint URL. Key differences from the CLI proxy: Azure Foundry handles base64 content blocks natively (no Read-tool fallback needed), and resolves as `provider: "azure-foundry"` (not `"openai"`). Proxy detection in `index.ts` and `page-analysis.ts` checks `provider === "openai"` to avoid misrouting Azure Foundry through the proxy Read-tool path. All AI routing files (`index.ts`, `comparison.ts`, `mapping.ts`, `page-analysis.ts`) fall through `"azure-foundry"` to the Anthropic adapter. Validation (`validate-key.ts`) uses `claude-haiku-4-5` with 15s timeout and includes 404 handling for bad endpoint URLs.

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
- **Auto-cleanup**: `src/lib/storage/cleanup.ts` runs every 24h via BullMQ in the detail worker:
  1. **Retention cleanup** — deletes `ScrapeSession` records older than `SCRAPE_RETENTION_DAYS` (default 7). Cascade deletes items, files, events, comparisons, validations. Removes files + screenshots from disk.
  2. **Orphan cleanup** — deletes files on disk under `portal-files/` with no DB reference, plus empty directories.
- Set `SCRAPE_RETENTION_DAYS` env var to control retention (default: 7 days)

### AI Extraction (BYOK Multi-Provider)
- Entry point: `extractFieldsFromDocument()` from `src/lib/ai/index.ts`
- Adapters: `src/lib/ai/anthropic.ts`, `openai.ts`, `gemini.ts`, `proxy-extraction.ts`
- Shared parser: `src/lib/ai/parse.ts` — all providers return same JSON format
- Prompts: `src/lib/ai/prompts.ts`; Types: `src/lib/ai/types.ts`
- Key validation: `src/lib/ai/validate-key.ts` (minimal API call before saving)
- Images → base64 content blocks; PDFs → base64 document blocks; DOCX → graceful error
- **`knownDocumentTypes?: string[]`** on `AIExtractionRequest` — when provided, injected into the system prompt so the AI picks from the exact list instead of free-texting. Pass `cachedDocTypes.map(dt => dt.name)` from the worker. Falls back to free-text description when omitted (auto-form extraction path is unaffected).

### AI Extraction — CLI Proxy Read-Tool Path
- **Problem**: CLI-based proxies (e.g. `claude-max-api-proxy`) wrap Claude Code CLI as a subprocess and expose OpenAI-compatible `/v1/chat/completions`. They serialize messages to plain text — base64 `image_url` content blocks are silently dropped. Claude never sees the file.
- **Solution**: `src/lib/ai/proxy-extraction.ts` — when `baseURL` (proxy) and `storagePath` are set, skips base64 content blocks entirely. Instead sends a text-only prompt telling Claude to use its **Read tool** to open the file from the local filesystem. Claude reads PDFs/images multimodally via the Read tool.
- **Routing**: `index.ts` checks `baseURL && storagePath && !textContent` → routes to `extractWithProxyReadTool()` before the provider switch. BYOK users (no proxy) still use direct API adapters with native content blocks.
- **`storagePath`** on `AIExtractionRequest` — relative storage key (e.g. `portal-files/{portalId}/{itemId}/file.pdf`). Resolved to absolute path via `path.resolve(STORAGE_LOCAL_PATH, storagePath)`. Passed from both `item-detail-worker.ts` and `sessions/[id]/extract/route.ts`.
- **Timeout**: 120s (vs 60s for direct API) — extra time for Read tool round trip.
- **Parser robustness**: `parse.ts` `stripMarkdownFences()` tries strict then loose regex. `extractJsonObject()` fallback finds `{...}` containing `"documentType"` + `"fields"` in free-form agent responses.
- **Limitation**: Slower than direct API (~20-30s vs ~10s). Agent may occasionally wrap JSON in conversational text — parser handles this.

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

### Shared Types — Never Redeclare Inline
- `src/types/extraction.ts` — `ExtractedField`, `ExtractionState`, `SourceAssetData`
- `src/types/target.ts` — `TargetType`, `TargetField`, `TargetAssetData`
- `src/types/mapping.ts` — `FieldMapping`, `MappingState`
- `src/types/fill.ts` — `FillActionSummary`, `FillReport`, helpers
- `src/types/audit.ts` — `AuditEventSummary`, display helpers
- `src/types/session.ts` — `SessionSummary`, `SessionDetailSummary`
- `src/types/portal.ts` — `TrackedItemStatus`, `ComparisonFieldStatus`, `COMPARISON_FIELD_STATUSES`, `FieldComparison`, `ComparisonResultSummary`, `ItemFile`, `ComparisonSummary`, `ValidationAlert`, `DiscoveredClaimType`, selector types, `ITEM_EVENT_TYPES`, `ItemEventType`, `ItemEventSummary`, `EVENT_TYPE_LABELS`, `EVENT_SEVERITY`, `FWA_PRIORITY`

### Shared Utilities (`src/lib/utils.ts`)
- `cn()` — className merging; `formatDate()` — en-SG locale; `sanitizeFileName()`, `formatFieldLabel()`, `confidenceVariant()`
- `toInputJson()` — strips `undefined` via JSON round-trip for Prisma `InputJsonValue`. Never use bare `JSON.parse(JSON.stringify(...))` directly.
- `toggleArrayItem<T>(arr, item)` — removes item if present, appends if absent; use for checkbox array state in portal doc type selectors

### RSC Serialization — Lucide Icons
Never pass Lucide icon components as props from Server → Client Components (functions don't serialize). Pass pre-rendered `<Icon />` JSX instead. `EmptyState` accepts `icon` as `React.ReactNode`.

### Production Hardening
- **Env validation**: `src/lib/env.ts` — Zod schema, imported by `db.ts` for fail-fast
- **Rate limiting**: `src/lib/rate-limit.ts` — `globalLimiter` (100/min IP), `authLimiter` (10/min IP), `aiLimiter` (5/min user)
- **Retry**: `src/lib/retry.ts` — `withRetry()` with exponential backoff, max 2 retries on 429/5xx
- **AI timeouts**: 60s extraction, 30s mapping, 15s key validation
- **Health check**: `GET /api/health` — pings DB + Redis; excluded from auth middleware

### Portal Tracker — Scrape Filters
- **Purpose**: Per-portal exclusion rules applied at scrape time — matched rows are never written to `TrackedItem` or processed by AI
- **Storage**: `Portal.scrapeFilters` (JSONB, default `{}`). Shape: `{ excludeByStatus: string[], excludeBySubmittedBy: string[] }`
- **Type**: `ScrapeFilters` interface + `DEFAULT_SCRAPE_FILTERS` in `src/types/portal.ts`
- **Validation**: `scrapeFiltersSchema` in `src/lib/validations/portal.ts`; added to `updatePortalSchema` — saved via `PATCH /api/portals/[id]`
- **Worker filtering — two-stage**:
  - `excludeByStatus` — applied at **list scrape time** (`portal-worker.ts`): case-insensitive match on `row.fields["Status"]`. Matching rows are never written to `TrackedItem`.
  - `excludeBySubmittedBy` — applied at **detail scrape time** (`item-detail-worker.ts`): "Submitted By" is only available on the detail page, so it is checked after detail scrape. On match the `TrackedItem` is **deleted** (not set to SKIPPED) and `itemsFound` is decremented — the item never appears in the session table.
  - **Do NOT add `excludeBySubmittedBy` to the portal-worker list filter** — the field is absent from list page data and the check would always be a no-op.
- **UI**: `ScraperFiltersCard` (`src/components/portals/scraper-filters-card.tsx`) — two tag-inputs (type + Enter to add, × to remove). Sits between the 4-column grid and Field Discovery on the portal detail page. Shows **Active** badge on header when any filter is configured
- **Migration**: `20260421000000_add_scrape_filters`

### Portal Tracker (RPA + Comparison Engine)
- **Purpose**: Scrape authenticated portals, download files, AI-compare portal data vs PDF data
- **Browser automation**: Playwright in BullMQ workers only. Singleton browser via `src/lib/playwright/browser.ts`
- **Auth**: Cookie injection (Chrome Extension capture) or credential login. `resolveAuth()` tries cookies first
- **Cookie capture**: Extension popup POSTs to `/api/extension/cookies` → matched to portal by URL domain → saved via `portalCredential.upsert`
- **Extension messaging**: Content script bridge on IVM pages (`content.js`) is primary path. External `chrome.runtime.sendMessage` with retry is fallback. MV3 service workers terminate after ~30s — handled by retry
- **AI page analysis**: `analyzePageStructure()` — screenshot + HTML → CSS selectors. Uses `page.waitForFunction()` for SPA render (body text > 200 chars or rows present) + 2s settle before screenshot
- **Scrape queue**: `portal-scrape-queue.ts` — concurrency 1, no retry
- **Detail queue**: `item-detail-queue.ts` — concurrency 3, 2 attempts, 5min lock, startup recovery for PROCESSING items stuck from crashes
- **BullMQ job deduplication**: `enqueueItemDetail` uses stable `jobId: item_${trackedItemId}` to prevent double-processing. **CRITICAL**: BullMQ silently drops `addBulk` entries whose jobId already exists in any state (including completed/failed). Always pass `{ reprocess: true }` to `enqueueItemDetailBatch` when re-enqueuing from the reprocess route — it removes the old terminal job before re-adding. Never call `enqueueItemDetailBatch` without this flag for retry/continue flows or the jobs will silently be no-ops.
- **Session items page — isActive rule**: `AutoRefresh` only renders when `scrapeSession.status === "RUNNING" | "PENDING"` OR `PROCESSING > 0`. DISCOVERED items on a COMPLETED/CANCELLED session do NOT trigger auto-refresh — they are queued but need user action ("Continue"). Do NOT add `DISCOVERED > 0` to `isActive` or the spinner loops forever on stalled sessions.
- **Session items page — stable sort**: Items ordered by `[{ createdAt: "asc" }, { id: "asc" }]`. The secondary `id` sort is required — items created within the same second (common in batch scrapes) have identical `createdAt`, and without a tiebreaker the DB returns them in random order causing rows to jump on every refresh.
- **Session actions**: Stop (CANCELLED + drains BullMQ jobs), Delete (cascade), Retry failed, Continue unprocessed. Stop button shows only when `sessionStatus === "RUNNING"` OR `counts.PROCESSING > 0` — not shown for already-cancelled sessions with only DISCOVERED items queued. Resume (reprocess) from CANCELLED resets session back to COMPLETED.
- **Auto-retry on error**: `SessionActions` auto-calls `reprocess("failed")` once via `useEffect` when `counts.ERROR > 0` and `inFlight === 0`. Guards: `useRef` (per mount) + `sessionStorage` key per session (survives auto-refresh reloads).
- **Session items page**: fetches `detailData` + `comparisonResult` (including `fieldComparisons`) + all FWA `validationResults` for up to 50 items. `TrackedItemsTable` renders expandable rows with a **3-column layout** (`src/components/portals/expanded-row/`):
  - **Column 1 — Portal Details**: `detailData` key-value list with match indicator icons (green/red/yellow) per field based on comparison status. Falls back to `listData` if detail not scraped. Includes "Open in Portal" link.
  - **Column 2 — Comparison & Alerts**: Full field comparison table (all rows, scrollable), match/mismatch summary + match rate %, AI summary text, and all FWA alerts.
  - **Column 3 — Document Viewer**: File selector chips (one at a time), inline blob-based viewer (images with drag-to-pan, PDFs in iframe via `blob:` URL to bypass `X-Frame-Options: DENY`). 500px fixed height.
  - Status line at top shows pass/fail/processing state with error message if failed. No event timeline in expanded row (available on full detail page only).
- **Prisma models**: `Portal`, `PortalCredential`, `ScrapeSession`, `TrackedItem`, `TrackedItemFile`, `ComparisonResult`, `TrackedItemEvent`, `ComparisonConfig`, `ComparisonTemplate`, `ProviderGroup`
- **Types/Validations**: `src/types/portal.ts`, `src/lib/validations/portal.ts` — all selector fields `.optional().nullable()`
- **Status colors**: `ITEM_STATUS_COLORS` exported from `src/components/portals/portal-status-badge.tsx`

### Portal Tracker — Comparison Configs & Templates
- **Purpose**: Per-claim-type field selection + match rules so AI comparison is focused instead of comparing all fields
- **Multi-config support**: Each portal can have multiple `ComparisonConfig` records, each with its own `groupingFields` and set of `ComparisonTemplate` records. Allows different comparison strategies per portal (e.g. one config grouped by "Claim Type", another by "Payer").
- **Config model**: `ComparisonConfig` — `portalId`, `name`, `groupingFields` (JSONB array). Unique on `(portalId, name)`. Portal detail page shows a card per config with "Add Claims Configuration" button.
- **Backward compat**: `Portal.groupingFields` is synced from config-level fields (union of all configs) for use by unconfigured-types and recompare APIs. `ComparisonTemplate.comparisonConfigId` is nullable — legacy templates without a config still match via portal-level groupingFields.
- **Config APIs**: `GET/POST /api/portals/[id]/configs`, `PATCH/DELETE /api/portals/[id]/configs/[configId]`
- **Template model**: `ComparisonTemplate` — `portalId`, `comparisonConfigId` (nullable), `name`, `groupingKey` (JSONB), `fields` (JSONB array of `{portalFieldName, documentFieldName, mode, tolerance?}`)
- **Match modes**: `fuzzy` (default, ignore formatting), `exact` (any difference = mismatch), `numeric` (numeric within tolerance)
- **Comparison prompt rules** (`src/lib/ai/prompts-comparison.ts`): System prompt uses principle-based rules — no hardcoded examples. Key rules: (1) ignore leading punctuation on IDs/invoice numbers (`#C313875` = `C313875`); (2) semantic parent-brand matching for organization names — if two provider names share root brand words and one is plausibly a branch/variant, treat as MATCH (e.g. "Raffles Medical Teleconsult" vs "Raffles Medical Singapore"). Do NOT add hardcoded provider examples to the prompt — the rule is intentionally generic so the AI applies its own world knowledge.
- **Expanded row — AI Comparison & Alerts column**: Section header is "AI Comparison & Alerts". Shows match/mismatch summary, AI narrative summary, Diagnosis pill (pulled from `pdfValue` in `fieldComparisons` — AI-extracted from document, not portal), field comparison table, FWA alerts.
- **Template lookup**: `findMatchingTemplate(portalId, itemData)` in `src/lib/comparison-templates.ts` — fetches all configs + templates, each template uses its config's grouping fields. Worker calls this before every AI comparison.
- **Template field filtering**: `filterFieldsByTemplate` passes through ALL fields unfiltered — both `pageFields` and `pdfFields`. AI-extracted PDF labels vary too much for substring matching (e.g. "Invoice Date" vs "Bill Date"). Prompt size is controlled via compact JSON formatting in `prompt-builder.ts` instead.
- **Prompt compaction** (`src/lib/ai/prompt-builder.ts`): `buildFullComparisonUserPrompt` uses single-line `JSON.stringify()` (no pretty-print) for both page and PDF fields. PDF field values truncated at 200 chars via `compactFields()`. This keeps prompts manageable for 130+ field items within the 180s AI timeout.
- **Per-portal AI model override**: `Portal.comparisonModel String?` — when set, overrides the user's default text model for AI comparison in the item detail worker. Options: `null` (use user's BYOK/system setting), `"claude-sonnet-4-6"`, `"claude-opus-4-6"`. Worker resolves as `(portal.comparisonModel ?? textModel)`. UI: "AI Model" card on portal detail page (5th card in the header grid), select dropdown auto-saves on change. Saved via `PATCH /api/portals/[id]` with `comparisonModel` field — the PATCH route passes validated data directly to `updateMany` so no route changes needed. Migration: `20260421200000_add_comparison_model`.
- **Fallback**: If no configs/grouping fields configured or no template matches, falls back to full AI comparison (all fields, no mode rules)
- **Inline prompt flow**: After a session completes, `SessionActions` fetches `/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types` — items that used full comparison with no template. Response includes `configId` of first matching config. Prompts user to configure a template via `ComparisonTemplateModal` (passes configId). On save, calls recompare API.
- **Recompare API**: `POST .../recompare` with `{ templateId }` — re-runs AI comparison on matching items using template rules, replaces old `ComparisonResult`
- **Templates page**: `/portals/[id]/templates?configId=xxx` — shows config-specific setup. Auto-creates default config if none exist.
- **Template UI**: `GroupingFieldConfig` (set grouping fields per config), `TemplateList` (view/delete templates per config), `ComparisonTemplateModal` (configure new template inline), `PortalComparisonSetup` (wrapper with copy/delete config)
- **Item detail view**: Shows template name badge or "Full comparison" badge alongside provider on the comparison result card
- **Key helper**: `itemMatchesGroupingKey(groupingFields, itemData, templateKey)` — pure function, used in both template matching and recompare filtering
- **Copy setup API**: `POST /api/portals/[id]/comparison-setup/import` with `{ sourcePortalId }` — copies all `ComparisonConfig` records + their templates + provider groups from source portal in a single transaction; deletes existing configs/templates/groups on target first. Provider group IDs are remapped so template→group FK references remain valid.
- **Copy setup UI**: "Copy from portal" ghost button in Comparison Setup card header → fetches portal list → select source → import. Auto-refreshes on success.

### Portal Tracker — Provider Groups
- **Purpose**: Generic provider classification layer for templates. Different providers (e.g. Government Restructured vs Private hospitals) can have different comparison rules/required documents for the same claim type.
- **Model**: `ProviderGroup` — `portalId`, `name`, `providerFieldName` (which item field to match against), `matchMode` ("list" or "others"), `members` (JSONB array of provider names for "list" mode). Unique on `(portalId, name)`.
- **Match modes**: `list` — normalized substring fuzzy match against member names. `others` — catch-all for providers not matched by any "list" group sharing the same groupingKey.
- **Template integration**: `ComparisonTemplate.providerGroupId` (nullable FK, ON DELETE SET NULL). Templates without a provider group apply to all providers (backward-compatible). When multiple templates match the same groupingKey, provider group disambiguates.
- **Matching priority** (`src/lib/comparison-templates.ts`): "list" groups checked first via fuzzy match → "others" mode fallback → templates without providerGroup → null (full comparison)
- **Fuzzy matching**: `normalizeForMatch()` lowercases, trims, collapses whitespace. `fuzzyMatchProvider()` checks if normalized item value contains any normalized member as substring, or vice versa.
- **Cache**: Provider groups loaded alongside templates in the 60s TTL cache. All provider group mutations clear the cache.
- **APIs**: `GET/POST /api/portals/[id]/provider-groups`, `PATCH/DELETE /api/portals/[id]/provider-groups/[groupId]`
- **UI**: `ProviderGroupsCard` (`src/components/portals/provider-groups-card.tsx`) — self-fetching management card on portal detail page. Add/edit/delete groups inline with tag-input for members. Shows matchMode badge, member chips, template count per group.
- **Template modal**: `ComparisonTemplateModal` shows optional provider group dropdown when groups exist. `SessionActions` fetches groups alongside unconfigured-types.
- **Template list/detail**: Shows provider group badge next to template name when assigned.
- **Migration**: `20260421100000_add_provider_groups`

### Portal Tracker — Field Discovery
- **Purpose**: Lightweight pre-scrape step that discovers claim type combinations and their detail page field labels. Users configure templates BEFORE the first full scrape — no wasted comparison runs.
- **Flow**: Select grouping columns → click "Discover Fields" → system scrapes list page, groups by selected columns, visits ONE detail page per unique combo to extract field labels → results shown as cards with field chips → user clicks "Configure" to create templates with pre-populated `availableFields`.
- **Backend**: `src/lib/portal-discovery.ts` — `discoverFields()` reuses `resolveAuth()`, `scrapeListPage()`, `scrapeDetailPage()`. Visits only N detail pages (one per unique grouping combo) instead of all rows. Saves results to `Portal.discoveredClaimTypes` (JSONB).
- **API**: `POST /api/portals/[id]/discover` with `{ groupingFields: string[] }`. Validates via Zod, delegates to `discoverFields()`.
- **UI**: `src/components/portals/field-discovery.tsx` — checkbox column picker, discover button, results cards with `FieldChips` (expandable, limit 8), "Configure" link per combo, "Re-discover" refresh.
- **Type**: `DiscoveredClaimType` in `src/types/portal.ts` — `{ groupingKey, detailFields, sampleUrl, discoveredAt }`
- **Template integration**: Template detail page (`templates/[templateId]/page.tsx`) matches discovery data to template's `groupingKey` and passes `availableFields` to business rules UI.
- **Business rules UI**: `TemplateBusinessRules` shows collapsible "Available portal fields (N)" chip list from discovery data so users reference exact field names.

### Portal Tracker — Cross-Item Duplicate Detection
- **Purpose**: Post-session check that flags same-date duplicate visits across items — AI only sees one item at a time, so duplicates require cross-item logic.
- **Backend**: `src/lib/validations/cross-item.ts` — `runCrossItemChecks(sessionId)`. Auto-detects date fields (e.g. "Incurred Date", "Admission Date") and patient fields (e.g. "Employee", "Claimant") via regex patterns. Groups items by (patient + date), creates `ValidationResult` with `ruleType: "DUPLICATE"` and `status: WARNING` for groups with 2+ items.
- **Trigger**: `item-detail-worker.ts` fires `runCrossItemChecks()` when `itemsProcessed === itemsFound` (exact equality prevents duplicate runs under concurrency). Fire-and-forget with error logging.
- **Batch optimization**: Pre-fetches all existing DUPLICATE validation results in one query to avoid N+1 per-item checks.

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
- **Timeline UI**: `src/components/portals/item-event-timeline.tsx` — auto-refreshes every 3s while PROCESSING/DISCOVERED; colored dots (red/green/grey), expandable payload, screenshot lightbox; rendered on the full item detail page only (not in expanded table rows)
- **Screenshot path validation**: `screenshotPath` must start with `portal-events/{itemId}/` — validated in screenshot API route before storage download

### Scraper — File Downloads
- **Primary method**: `page.request.get(href)` — inherits session cookies, works for inline PDFs and new-tab links that never trigger a browser download event
- **Parallel**: All href-based links fetched concurrently via `Promise.allSettled()`; `javascript:` / onclick fallback runs sequentially after (clicking navigates the page)
- **tmpDir**: Created lazily — only when there are `javascript:` links; skipped entirely for href-only pages
- **Click+download fallback**: Only for links with no navigable `href`. Uses `page.waitForEvent("download")` — will silently fail if portal serves file inline

### Scraper — Garbage Data Filtering
- `filterGarbageFields()` in `scraper.ts` — detects when fallback extraction (no `fieldSelectors`) grabs noise from non-claim page sections (e.g. access management panels with 150+ identical "Manage Access" values)
- Heuristic: if >50% of field values are identical and count >5, removes those entries
- **Worker data preservation**: `item-detail-worker.ts` uses `effectiveDetailData` pattern — on BullMQ retry, if new scrape returns significantly fewer fields than existing `detailData` (<50%), keeps the existing data instead of overwriting with garbage

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

### Intelligence (Background Pipeline — No UI)
- **Purpose**: Document classification, FWA detection, and validation checks that run silently during Portal Tracker scrape sessions. No sidebar link, no management UI — all background only.
- **Portal Tracker only**: Runs in `item-detail-worker.ts` only. Auto Form has no intelligence integration.
- **No UI**: All `/intelligence/*` pages, API routes (`/api/intelligence/*`), and intelligence components have been removed. Document types are managed directly via the DB if needed.
- **Migrations**: `20260410200000_add_intelligence_hub` (all tables), `20260411000000_add_expected_doc_type_to_scrape_session`, `20260413100000_add_default_doc_type_to_portal`, `20260413200000_multi_acceptable_doc_types`

#### Runtime lib (`src/lib/intelligence/`)
- `classifier.ts` — `fetchDocTypes(userId)` queries DB directly; `classifyDocumentTypeFromCache(aiDocType, docTypes)` Jaro-Winkler fuzzy match (fallback — AI receives exact names in prompt)
- `validator.ts` — `validateRequiredFields(docType, extractedFields, options)`; `checkDocTypeMatch(...)` writes `DOC_TYPE_MATCH` FAIL/WARNING `ValidationResult` when classified type not in `acceptableDocumentTypeIds`
- `deduplicator.ts` — `checkDuplicate(userId, documentTypeId, keyFields, extractedFields, options)` SHA-256 hash, 90-day lookback
- `tampering.ts`, `anomaly.ts`, `document-forensics.ts` — FWA checks called from worker

#### Prisma models
- `DocumentType`, `ValidationResult` (trackedItemId?, ruleType, status PASS/FAIL/WARNING, message, metadata JSON)
- `Portal.defaultDocumentTypeIds String[]`, `ScrapeSession.acceptableDocumentTypeIds String[]`

#### Worker integration (`item-detail-worker.ts`)
`fetchDocTypes` runs before extraction loop so `knownDocumentTypes` names are injected into the AI prompt. Non-fatal pipeline: classify → validate required fields → check duplicate → check doc type match. Never blocks comparison pipeline.

#### FWA display
- `FWA_RULE_TYPES` (Set) and `FWA_LABELS` (Record) in `src/types/portal.ts` — shared by `TrackedItemsTable`, `ComparisonColumn`, and `ItemDetailView`. Add new alert types here only.
- `DOC_TYPE_MATCH` → "Wrong Doc Type" badge; `BUSINESS_RULE` / `REQUIRED_DOCUMENT` → alert badges in FWA column
- **Table row**: shows single worst FWA alert badge (priority: FAIL > WARNING, TAMPERING > DUPLICATE > others)
- **Expanded row**: shows ALL FWA alerts per item — fetched server-side via `fwaAlertsByItem` Map built from `validationResult.findMany()` in session page
- **Validation API**: `GET /api/portals/[id]/scrape/[sessionId]/items/[itemId]/validations`
- **Key constraint**: `ValidationResult` has no Prisma relation to `TrackedItem` (raw FK only) — query via `where: { trackedItemId }` directly, never `include`

## Deployment

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **SSH**: `ssh -i /c/Users/huien/.ssh/id_ed25519 root@72.62.75.247`
- **Database**: Supabase PostgreSQL in Docker on port **5433** (NOT 5432)
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
npx prisma db seed           # seeds dev@ivm.local / password123
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
scripts/                    # VPS worker start scripts
```
