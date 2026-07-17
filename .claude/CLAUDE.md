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

### AI Providers — Local Model (oMLX / Qwen3-VL, self-hosted)
- **Provider id `"local"`**: a self-hosted vision model exposed over an **OpenAI-compatible** endpoint (oMLX serving Qwen3-VL). Distinct from `"openai"` so it never triggers the Claude-CLI-proxy Read-tool path. `AIProvider` union lives in BOTH `src/lib/ai/types.ts` and `src/lib/validations/api-key.ts` — keep them in sync.
- **Routing**: `local` routes through the **OpenAI SDK** functions in every path — extraction (`openai.ts`), mapping, comparison, page-analysis, vision-verify. `resolveProviderAndKey()` sets `baseURL` from the stored `endpoint` for `local` (same as `azure-foundry`, which uses the Anthropic SDK).
- **Endpoint providers**: `ENDPOINT_PROVIDERS = ["azure-foundry", "local"]` in `validations/api-key.ts` drives the "endpoint required" schema refine + the Settings UI endpoint field. Endpoint normalization is provider-aware in `api/settings/api-keys/route.ts`: azure strips `/v1/messages`; local keeps `/v1`, only trims trailing slashes.
- **PDF rasterization**: local vision models take **images, not PDFs**. `src/lib/ai/pdf-raster.ts` (`rasterizePdfToImages`, backed by `pdf-to-img` → native `canvas` + `pdfjs-dist`, dynamically imported) converts PDFs to PNG pages before the call. Wired in `index.ts` (extraction, cap 10 pages) and `vision-verify.ts` (cap 4). `next.config.ts` `serverExternalPackages` must list `pdf-to-img`, `canvas`, `pdfjs-dist`. Azure VM needs node-canvas runtime libs (already present via Playwright's `install-deps`; else `apt-get install libcairo2 libpango-1.0-0 libjpeg-turbo8 libgif7 librsvg2-2`).
- **Vision-checks rasterize-once**: `vision-checks.ts` rasterizes each unique PDF a single time into a `rasterCache` and passes `images` into `verifyWithVision` (which prefers `req.images` over re-rasterizing) — avoids redundant canvas renders across tasks on the same file.
- **Freeform model ids**: `PROVIDER_MODELS.local.freeform = true` — model id is user-entered free text (matches the HF id loaded in oMLX, e.g. `mlx-community/Qwen3-VL-32B-Instruct-8bit`), rendered as a datalist input not a dropdown. The `model-preferences` PUT **skips the fixed-id allow-list for `freeform` providers**. On key save, the validated model id is persisted into `modelPreferences` (both vision+text) so runtime uses the connected model, not the default.
- **SSRF guard**: `assertSafeEndpoint()` in `src/lib/endpoint-safety.ts` runs on save for all endpoint providers — blocks cloud-metadata / link-local (`169.254.0.0/16`, `metadata.google.internal`, IMDS IPv6) and non-http(s) schemes; loopback/LAN/Tailscale (`100.64.0.0/10`) intentionally allowed.
- **Validation errors**: `validateLocalKey` uses OpenAI SDK error classes (`APIConnectionTimeoutError`/`APIUserAbortError`/`APIConnectionError`, `maxRetries: 0`) for precise "unreachable / timed out / bad key / model not found" messages.
- **Deployment topology**: production IVM runs on the Azure VM, so oMLX cannot bind pure loopback — bind it to the Tailscale interface and enter `http://<mac-tailscale-ip>:8000/v1` as the endpoint.

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
- **Auth**: Cookie injection (Chrome Extension capture) or credential login. `resolveAuth()` tries cookies first, detects login page after navigation (URL patterns + password input check), falls back to credentials if login detected. `isLoginPage()` exported for per-item auth checks.
- **Auth circuit breaker**: If detail worker detects auth failure (login page, expired session), it marks all remaining DISCOVERED items in the session as ERROR with a clear message, preventing hundreds of identical failures. Triggered by error messages containing "session expired", "login", "authentication".
- **Cookie capture**: Extension popup POSTs to `/api/extension/cookies` → matched to portal by URL domain → saved via `portalCredential.upsert`
- **Extension messaging**: Content script bridge on IVM pages (`content.js`) is primary path. External `chrome.runtime.sendMessage` with retry is fallback. MV3 service workers terminate after ~30s — handled by retry
- **AI page analysis**: `analyzePageStructure()` — screenshot + HTML → CSS selectors. Uses `page.waitForFunction()` for SPA render (body text > 200 chars or rows present) + 2s settle before screenshot
- **Scrape queue**: `portal-scrape-queue.ts` — concurrency 1, no retry
- **Detail queue**: `item-detail-queue.ts` — concurrency 2, 10min lock (`LOCK_DURATION_MS`), startup recovery for PROCESSING items stuck from crashes. Job timeout (`JOB_TIMEOUT_MS` in `item-detail-worker.ts`) is also 10min. Concurrency is intentionally low to prevent AI calls from competing and timing out.
- **Job timeout race fix**: `withTimeout()` accepts an `onTimeout` callback. On timeout it calls `handleFinalFailure` (sets DB to ERROR + increments `itemsProcessed`) before rejecting, so the BullMQ slot isn't freed until the DB is updated — preventing the brief "N+1 PROCESSING" display glitch. The catch block in `processItemDetailCore` checks `alreadyHandled` (item status already ERROR) before incrementing `itemsProcessed` — prevents double-counting when `handleFinalFailure` already ran via the timeout callback.
- **Session actions**: Stop (CANCELLED + drains BullMQ jobs), Delete (cascade), Retry failed, Continue unprocessed. Stop button shows whenever `inFlight > 0` (PROCESSING or DISCOVERED items exist) — not gated on sessionStatus. Resume (reprocess) from CANCELLED resets session back to COMPLETED.
- **Auto-retry on error**: `SessionActions` auto-calls `reprocess("failed")` once via `useEffect` when `counts.ERROR > 0` and `inFlight === 0`. Guards: `useRef` (per mount) + `sessionStorage` key per session (survives auto-refresh reloads). Skipped when `authStatus` is `expired` or `missing`.
- **Auth pre-flight validation**: `assertAuthValid()` from `src/lib/portal-auth.ts` — shared helper used by scrape start and reprocess APIs. Returns 400 ValidationError if cookies expired without credential fallback or no auth configured. `AuthStatus` type (`"ok" | "warn" | "expired" | "session_expired" | "missing"`) exported from `src/types/portal.ts`. Session page computes `authStatus` (static cookie check) then `effectiveAuthStatus` (overrides with `authExpiredAt` from session). "Continue", "Retry", and "Scrape Now" buttons disabled with tooltip when auth is bad.
- **Auth circuit breaker**: Worker uses exact error signatures (`AUTH_ERROR_SIGNATURES` in `item-detail-worker.ts`) to detect auth failures. On match, marks all remaining DISCOVERED items as ERROR, increments `itemsProcessed` by the cancelled count, AND stamps `authExpiredAt: new Date()` on the `ScrapeSession` so the frontend can detect runtime auth failures even when `cookieExpiresAt` hasn't passed.
- **Runtime auth expiration detection**: `ScrapeSession.authExpiredAt` (nullable DateTime) is set by the circuit breaker when the portal invalidates the session server-side before cookies technically expire. Session page computes `effectiveAuthStatus`: if `authExpiredAt` is set and static `authStatus` is `"ok"`, overrides to `"session_expired"`. `AuthStatus` type includes `"session_expired"`. `SessionActions` treats it as `authBad` — shows red banner ("Portal session expired during scraping…"), disables retry/continue buttons, blocks auto-retry. Reprocess API clears `authExpiredAt: null` when user retries after fixing cookies.
- **Session resume auto-refresh**: Reprocess API sets `completedAt: null` on any session (not just CANCELLED) when re-enqueuing items. Session page `isActive` checks for `(status === "COMPLETED" && !completedAt)` to enable auto-refresh during reprocessing. When the detail worker finishes the last item (`itemsProcessed === itemsFound`), it restores `completedAt: new Date()` so auto-refresh stops.
- **Reprocess `itemsProcessed` integrity**: When ERROR items are retried, the reprocess API decrements `itemsProcessed` by the count of ERROR items being reset (they were already counted when they first failed). This prevents double-counting and ensures `finalizeIfComplete` fires at the right time after retry.
- **`handleFinalFailure` finalization**: When a timed-out job causes the last item in a session to fail, `handleFinalFailure` now writes `completedAt: new Date()` and calls `runCrossItemChecks` — matching `finalizeIfComplete`. Previously only `snapshotPortalDayAsync` was called, leaving the session in a perpetual "Running…" state.
- **Dashboard processed count**: `GET /api/portals/summary` returns `totals.processed` excluding DISCOVERED/PROCESSING items. Dashboard "Items Processed" card and flag rate use this count, not total items.
- **Summary period sources (retention-aware)**: `GET /api/portals/summary` must NOT read the current month/year purely from live `scrapeSession` rows — retention cleanup deletes sessions older than `SCRAPE_RETENTION_DAYS` (default 7), so a live-only month/year query undercounts (only the last ~7 days survive) while portal cards (snapshot-based) show full totals. Resolution by view: current **day** → live; current **month/year** → `buildSnapshotSummary` for `[period-start, today)` (persistent `portalDailyMetrics`) **merged** with `buildLiveSummary` for `today` only via `mergeSummaries`; past periods → snapshot-first with live fallback. Ranges are disjoint (`lt: today` vs `>= todayStart`) so no double-count. Note: snapshots are written at session finalize and survive retention; `backfillPortalMetrics()` can only re-derive from surviving sessions, so it CANNOT reconstruct purged days — never rely on backfill to fix a purged month.
- **Portal card item count**: Shows `totalProcessed / totalFound processed` — cumulative across ALL sessions, sourced from `portalDailyMetrics` snapshots (survives retention cleanup). `PortalSummary` carries `totalProcessed` (sum of compared+flagged+errors+skipped+verified) and `totalFound` (sum of items). Hidden when `totalFound === 0` and no status badge. The portals page uses `groupBy` on `portalDailyMetrics` — NOT `scrapeSessions` — so counts persist even after 7-day retention deletes old sessions.
- **Session items page**: fetches `detailData` + `comparisonResult` (including `fieldComparisons`) for all items (no limit). `TrackedItemsTable` renders expandable rows with clickable status filter pills — click a status pill to filter the table, click again to clear. No horizontal scroll.
- **Prisma models**: `Portal`, `PortalCredential`, `ScrapeSession`, `TrackedItem`, `TrackedItemFile`, `ComparisonResult`, `TrackedItemEvent`, `ComparisonTemplate`
- **Types/Validations**: `src/types/portal.ts`, `src/lib/validations/portal.ts` — all selector fields `.optional().nullable()`
- **Status colors**: `ITEM_STATUS_COLORS` exported from `src/components/portals/portal-status-badge.tsx`

### Portal Tracker — Comparison Templates
- **Purpose**: Per-claim-type field selection + match rules so AI comparison is focused instead of comparing all fields
- **Grouping fields**: Portal-level `groupingFields: string[]` — which scraped fields identify a "claim type" (e.g. `["Claim Type", "Payer"]`). Configured via `GroupingFieldConfig` on portal detail page.
- **Template model**: `ComparisonTemplate` — `portalId`, `name`, `groupingKey` (JSONB, e.g. `{"Claim Type": "Inpatient"}`), `fields` (JSONB array of `{portalFieldName, documentFieldName, mode, tolerance?, verifyWithVision?}`)
- **Match modes**: `fuzzy` (default, ignore formatting), `exact` (any difference = mismatch), `numeric` (numeric within tolerance)
- **Numeric auto-default**: `inferDefaultMode(fieldName)` in `src/types/portal.ts` — amount-like field names (amount/total/balance/payable/receipt/fee/gst/outstanding…, matched on word boundaries) default to `numeric` (0.01 tolerance) so `$169.60` vs `169.6` never falsely mismatches. Identifier/date names (number/id/code/date/type…) are explicitly excluded so they stay fuzzy/exact. Applied on add in `ComparisonTemplateModal` and on first-name in `TemplateFieldMappings`. NOTE: distinct from `detector.isAmountField` (currency detection, recall-biased — intentionally matches invoice/claim too); do not merge them.
- **Field-name matching**: `fieldNameMatchesPortal(fcName, portalFieldName)` in `comparison-templates.ts` — shared by `filterComparisonsByTemplate` and vision re-check so combined AI names ("Claim Amount / Total") resolve identically in both. Never re-implement field matching inline.
- **Template lookup**: `findMatchingTemplate(portalId, itemData)` in `src/lib/comparison-templates.ts` — fetches portal groupingFields + all templates, matches by case-insensitive key comparison. Worker calls this before every AI comparison.
- **Fallback**: If no grouping fields configured or no template matches, falls back to full AI comparison (all fields, no mode rules)
- **Inline prompt flow**: After a session completes, `SessionActions` fetches `/api/portals/${portalId}/scrape/${sessionId}/unconfigured-types` — items that used full comparison with no template. Prompts user to configure a template via `ComparisonTemplateModal`. On save, calls recompare API.
- **Recompare API**: `POST .../recompare` with `{ templateId }` — re-runs AI comparison on matching items using template rules, replaces old `ComparisonResult`
- **Template UI**: `GroupingFieldConfig` (set grouping fields), `TemplateList` (view/delete templates), `ComparisonTemplateModal` (configure new template inline) — all on portal detail page or session actions
- **Item detail view**: Shows template name badge or "Full comparison" badge alongside provider on the comparison result card
- **Key helper**: `itemMatchesGroupingKey(groupingFields, itemData, templateKey)` — pure function, used in both template matching and recompare filtering

### Portal Tracker — Document Recognition, Library & Required Documents
- **Purpose**: Recognise hospital documents regardless of how each provider titles them so required-document checks don't false-flag (e.g. an interim "Summary Bill" satisfies a "Summary Tax Invoice" requirement — fixes the CBRE-012480 class of false "missing document").
- **Deterministic recogniser**: `src/lib/intelligence/billing-docs.ts` — `recognizeDocuments()` resolves each file via (1) the alias library (`classifyDocumentTypeFromCache`) and (2) a `DOC_FAMILIES` synonym map (billing/receipt/discharge/referral/settlement). `matchDocFamily()` keys on the document's TYPE LABEL or canonical library name only — **never field text** (a receipt with an "Invoice No" field must not look like an invoice). `buildDocumentTypesFound()` builds the enriched "Documents found" list (raw type + canonical + family + bill-status) passed to the comparison LLM. Shared by worker + recompare.
- **Required-document reconciliation**: `reconcileRequiredDocChecks(llmChecks, requiredDocuments, recognizedDocs)` — for billing-type requirements WITH document labels present, the deterministic resolver is authoritative: it corrects a false "not found" AND downgrades a likely-false LLM "found" to manual review. For non-billing requirements (no domain knowledge) the LLM verdict is trusted. `resolveRequiredDocument()` tiers: canonical/alias and family CONFIRM (`found:true`); keyword overlap is weak → at most `uncertain` (never a confident found).
- **Confidence gating**: `buildRequiredDocValidations()` in `src/lib/intelligence/validation-builders.ts` (shared by worker + recompare) emits `REQUIRED_DOCUMENT` rows — `uncertain` → `WARNING` "Manual review recommended" (`metadata.severity:"review"`); genuine miss → `FAIL` (`critical`). Any unfound doc still flags the item.
- **Bill status (interim vs final)**: `detectBillStatus()` (interim signals like "this is not the final bill" win over final), `extractOutstandingBalance()`, `buildBillStatusSignal()` (a detected final bill wins over interim). `buildBillStatusValidation()` emits an informational `BILL_STATUS` `WARNING` (`severity:"info"`, does NOT flag). `BILL_STATUS` is registered in `FWA_RULE_TYPES`/`FWA_PRIORITY`/`FWA_LABELS`.
- **Persistence for recompare**: `ComparisonResult.documentTypesByFile` (JSONB, migration `20260610000000_add_document_types_by_file`) stores per-file type labels at scrape time so recompare runs identical recognition without re-extracting files.
- **Document Type Library (per-user)**: model `DocumentType` — `name` + `aliases` (alternative hospital titles, the continuous-learning surface) + `requiredFields` ("key fields"). `isActive=false` retires an outdated format while keeping it recognised (version control via additive aliases). The `category` column is dormant/unused (removed from UI/API). Managed at **Settings → Document Recognition** (`src/components/settings/document-types-manager.tsx`, uses shared `ui/tag-input.tsx`). CRUD: `/api/document-types`, `/api/document-types/[id]`; Zod in `src/lib/validations/document-type.ts`. Continuous-learning hook: `POST /api/document-types/learn` appends a misclassified label as an alias (upsert by name). **Key fields drive ONLY the completeness check** (`validateRequiredFields`); the document-fingerprint duplicate check was removed.
- **Required-documents editor**: `src/components/portals/required-documents-editor.tsx` — controlled, shared by the template detail view (`TemplateRequiredDocuments`) and the inline `ComparisonTemplateModal`. The document-type name autocompletes from the library; a ✓/⚠ indicator shows whether the name canonically matches a library entry, using the shared `src/lib/normalize.ts` `normalize()` — the SAME function the backend matches with, so the badge can't drift. Stable per-row keys. The templates create API (`POST /api/portals/[id]/templates`) persists `requiredDocuments` + `businessRules`.
- **Shared normalize**: `src/lib/normalize.ts` — single dependency-free `normalize()` (lowercase + strip non-alphanumeric) imported by both the backend classifier and the UI indicator.
- **Duplicate detection: REMOVED.** The per-document fingerprint check (`deduplicator.ts`) and the earlier cross-item visit check (`cross-item.ts`) no longer exist; no `DUPLICATE` `ValidationResult` rows are produced anywhere.

### Portal Tracker — Foreign Currency Conversion
- **Purpose**: Detect foreign-currency amounts and convert to SGD using the incurred date's exchange rate
- **Code**: `src/lib/validations/currency.ts` — `checkForeignCurrency(trackedItemId, pdfFields, pageFields)`, called by `item-detail-extraction.ts` after extraction
- **Both sides scanned**: a **document pass** over extracted PDF fields (with bare-number inference from document-level currency signals), AND a **portal pass** over `pageFields` amount fields (rule: a non-SGD *portal* receipt amount is converted too). Portal rows carry `origin:"portal"` and a "Portal — " message prefix; document rows carry `origin:"document"`. Deduped independently per side. Alert-only (`CURRENCY_CONVERSION` WARNING, non-flagging)
- **Currency detection**: `src/lib/currency/detector.ts` — `parseCurrencyAmount()` matches 18 currency patterns (returns null for SGD/bare numbers), `isDateField()` matches incurred/service/visit/billing date labels
- **Date resolution**: `findIncurredDate()` collects all date fields from portal page + PDF data, returns highest-priority match using `DATE_FIELD_PRIORITY` (Incurred Date > Service Date > Visit Date > Invoice Date > Discharge Date). Falls back to today if no date field found
- **Date parsing**: `parseDate()` handles ISO, DD/MM/YYYY, MM/DD/YYYY (disambiguates by range — if first number > 12 it's DD/MM, if second > 12 it's MM/DD, both ≤ 12 defaults DD/MM for SG locale), `DD Mon YYYY`, `Mon DD, YYYY`
- **Rate providers** (in order) via `resolveSgdRate()` in `src/lib/currency/index.ts`:
  1. **Frankfurter (ECB)** (`src/lib/currency/frankfurter.ts`) — free, keyless, date-accurate historical rates. **Primary source.**
  2. ExchangeRate-API (`src/lib/currency/exchangerate-api.ts`) — fallback; tries historical endpoint first (`/history/SGD/{Y}/{M}/{D}`), falls back to latest if plan lacks history
  - (MAS was retired — its old API 404s and data.gov.sg datasets end in 2015. Do NOT reintroduce a MAS-first path.)
- **RateResult type**: `rate`, `actualDate`, `isFallback`, `isFuture`, `isHistorical`, `source` ("frankfurter" | "exchangerate-api")
- **Caching**: ExchangeRate-API uses bounded `dateCache` (max 60 entries, 1-hour TTL, LRU eviction) + `failedHistorical` negative cache
- **UI**: `comparison-column.tsx` shows badges — ESTIMATED (future), NEAREST DATE (fallback), LIVE (exchangerate-api non-historical only)
- **Env var**: `EXCHANGE_RATE_API_KEY` — optional, from https://www.exchangerate-api.com (free plan: 1,500 req/mo, paid plans support historical endpoint)

### Portal Tracker — Global Claim Policy Verdicts
- **Purpose**: Built-in, global (all-portal) adjudication rules in `src/lib/validations/claim-policy.ts` (`buildClaimPolicyValidations`) — shared by the worker (`item-detail-comparison.ts`) and the recompare route. Deterministic signal detectors live in `src/lib/reference/claim-signals.ts` (pure regex/string, never throw). The policy receives `documentFields` (all extracted doc fields) for signal + amount scanning, plus `documentText` (provider-scoped billing text) for hospital detection.
- **Runs independent of the comparison** (worker): the policy block is NOT nested under `if (comparisonResult)` — rules 1/3 need only document fields, rule 4 only portal data, rule 6 only claim-type + provider, so an item with documents but no comparison (e.g. no portal page fields) is still adjudicated. Gated by `runPolicy = !preservePrior && !noDocuments && !allExtractionsFailed`. Rows are cleared+written by `persistPolicyValidations` (owns `POLICY_RULE_TYPES` = CLAIMANT_MATCH/WRONG_CLAIM_TYPE/SUBSIDY_DEDUCTION/NON_CLAIMABLE_PAYMENT/POSSIBLE_DUPLICATE/SPECIALIST_REVIEW), separate from `saveComparisonResult` (which owns only BUSINESS_RULE/REQUIRED_DOCUMENT/BILL_STATUS/UNREADABLE_DOCUMENT).
- **Claimant not in document → "pending document"**: locates the claimant field among the compared fields (`/claimant|life assured|insured|patient/i`, prefers a field literally "Claimant"); if its status is `MISSING_IN_PDF`, emits a `CLAIMANT_MATCH` FAIL row and sets the item to **`REQUIRE_DOC`** ("Require Doc" = pending document), which takes precedence over FLAGGED.
- **Rule 1 — Government subsidy/deduction → flag**: `detectSubsidyDeduction()` scans document signal text for **MediSave / CPF, CHAS, or CDC (Community Development Council) voucher**. Plain "CPF" only counts alongside a deduction/subsidy/payment context; MediSave/CHAS/CDC-voucher are strong standalone signals. Emits `SUBSIDY_DEDUCTION` FAIL + FLAGs (subsidised portion not claimable).
- **Rule 2 — Flex specialist consultation → flag for review**: gated to **flex claims** (`isFlexClaim()`). Fires when the max amount-labelled value exceeds **$100** OR `detectSpecialistIndication()` matches (`/specialist/i`). `detectSpecialistIndication` scans field **VALUES only** (a portal column merely LABELLED "Specialist …" must not flag every claim); `maxAmountFromFields` **skips explicit foreign-currency values** (`parseCurrencyAmount` non-null) so the SGD $100 threshold isn't tripped by a raw foreign figure. Emits `SPECIALIST_REVIEW` WARNING (`severity:"review"`) and FLAGs. NB: flags most flex claims over $100 by design (business rule).
- **Rule 3 — GIRO from a Child Development Account (CDA) → flag**: `detectGiroCdaPayment()` fires on a CDA/Baby-Bonus signal (bare "CDA" abbreviation trusted only alongside a GIRO mention). Emits `NON_CLAIMABLE_PAYMENT` FAIL + FLAGs (CDA funds not claimable). Distinct from rule 1's CDC voucher.
- **Rule 4 — Portal-flagged possible duplicate → flag**: `detectPossibleDuplicate()` reads the **portal page data only** (`pageText`) for a `/possible|potential|suspected duplicate|duplicate claim/i` marker the portal itself surfaces. Emits `POSSIBLE_DUPLICATE` FAIL + FLAGs.
- **Rule 5 — Foreign currency → flag**: handled in `src/lib/validations/currency.ts`; `checkForeignCurrency()` **returns a boolean** (foreign amount detected on either side, independent of rate-fetch success) and fetches rates **concurrently** (`Promise.all`, not sequential) so the now-awaited call costs one round-trip. Threaded: `runIntelligencePipeline` awaits it and returns `foreignCurrencyDetected` → worker passes `foreignCurrency` into `runComparison` → FLAGGED condition. `CURRENCY_CONVERSION` rows remain WARNING (display), but the item is FLAGGED.
- **Document-intrinsic flags preserved on recompare**: recompare does NOT re-extract files, so `CURRENCY_CONVERSION`, `SUBSIDY_DEDUCTION`, and `NON_CLAIMABLE_PAYMENT` (rules 5/1/3) are **preserved, not re-derived** — a single batched `validationResult.findMany` (`PRESERVED_DOC_RULE_TYPES`) builds `itemsWithPreservedFlag`; those rule types are excluded from the recompare `deleteMany` and their `policy.rows` are filtered out before insert. Re-derivable rules (CLAIMANT_MATCH/WRONG_CLAIM_TYPE/POSSIBLE_DUPLICATE/SPECIALIST_REVIEW) are recomputed normally. This avoids the worker↔recompare verdict divergence where a subsidy/GIRO signal in an un-mapped document field would be silently dropped.
- **Rule 6 — Polyclinic claim whose document is a hospital bill → wrong claim type**: **all portals** (generalizes the former flex-only rule). Fires when ANY candidate claim-type value (all grouping fields via `resolveClaimTypeValues` + claim-type-labelled fields) matches `/poly clinic|pcn/i` AND the **billing document's provider** is a known SG hospital (`detectHospital()`, `src/lib/reference/sg-hospitals.ts`, space-bounded longest-name-first over govt + private lists). Suppressed when the provider text itself names a polyclinic (`POLYCLINIC_PROVIDER_RE`). Hospital search text from `buildHospitalSearchText(fileExtractions, recognizedDocs)` — scoped to bill/receipt-family provider fields. Emits `WRONG_CLAIM_TYPE` FAIL + FLAGs; **flex** portals get the "should be an Insurance Claim" message, others get "not a polyclinic document".
- **Preserve-prior interaction**: all policy checks run ONLY inside the `!preservedPrior` branch of `runComparison` — a degraded re-run (a claimant's document transiently failed to extract) must not flip a previously-good item to a policy verdict. Currency amounts appearing on BOTH the document and portal are deduped (portal pass skips keys already emitted by the document pass).
- **FWA registration**: `CLAIMANT_MATCH`/`WRONG_CLAIM_TYPE`/`SUBSIDY_DEDUCTION`/`NON_CLAIMABLE_PAYMENT`/`POSSIBLE_DUPLICATE` (priority 2, FAIL) and `SPECIALIST_REVIEW` (priority 1, WARNING) in `FWA_RULE_TYPES`/`FWA_PRIORITY`/`FWA_LABELS` (`src/types/portal.ts`). Worker clears+writes policy rows via `persistPolicyValidations`; recompare clears the re-derivable subset inline (preserving document-intrinsic rows). The comparison-column UI renders new types generically via `FWA_LABELS`.

### Portal Tracker — Comparison Template Business Rules
- **Rule types**: `BusinessRule.type` — `"ai"` (default; natural-language judged by the model) or `"code"` (deterministic field/operator/value check). Code rules carry `field`, `operator` (`eq|ne|gt|gte|lt|lte|is_empty|not_empty`), and either `value` (literal) or `compareField` (another field). Use code rules for exact numeric/equality checks (e.g. "Outstanding Balance == 0") instead of asking the LLM to do arithmetic.
- **Code-rule evaluation**: `evaluateCodeRules(rules, data)` + `withCodeRuleResults(existing, rules, data)` in `src/lib/business-rules/evaluate-code-rules.ts`. Pure, deterministic; returns `BusinessRuleResult[]` (PASS/FAIL/NOT_APPLICABLE) with `ruleId` set for precise pairing. **Code rules are excluded from the LLM prompt** (`prompt-builder.ts` filters `type !== "code"`) and merged into the AI results afterward by BOTH the worker and the recompare route via `withCodeRuleResults`.
- **Field resolution (`resolveFieldValue`)**: exact (case/space-insensitive) → **unambiguous** prefix match only. Deliberately NO substring guessing ("Amount" must not bind to "GST Amount", "Paid" not to "Unpaid"); ambiguous/absent → NOT_APPLICABLE, never a wrong-field flag. A binary operator with a missing `compareField`/unconfigured `value` → NOT_APPLICABLE (misconfiguration, not a violation).
- **Severity → flagging** (`resolveRuleOutcome(aiStatus, severity)` in `src/lib/business-rules/flagging.ts`): the user-configured severity drives the item-level outcome, NOT the model's raw PASS/FAIL. `critical` + FAIL → stored FAIL + flags; `critical`/`warning` violations → flag the item; `info` violations → recorded as a WARNING note but NEVER flag. PASS/NOT_APPLICABLE → not recorded. `ValidationStatus` enum has no INFO, so info severity is stored as WARNING and distinguished via `metadata.severity`.
- **Persistence**: `buildBusinessRuleValidations(businessRules, results)` in `src/lib/business-rules/persist.ts` — single source of truth for both worker (`item-detail-comparison.ts`) and recompare route. Matches results back to rules by `ruleId` then rule text, applies `resolveRuleOutcome`, returns `{ validations, anyFlag }`. `anyFlag` drives the FLAGGED decision (required-document misses flag separately).
- **Save behavior**: Drops AI rows with empty description; keeps code rows that have `field` + `operator`. Blank category auto-fills to "General".
- **Zod validation**: `businessRuleSchema` (`src/lib/validations/portal.ts`) is a refined object — `type: "code"` requires `field` + `operator`; otherwise `rule` must be non-empty. Includes optional `verifyWithVision`, `field`, `operator`, `value`, `compareField`.
- **Editor UI**: `TemplateBusinessRules` — per-row type badge (AI/CODE), "AI rule"/"Code rule" add buttons, code-rule builder (field datalist + operator + value/compare-field), severity select, and a vision (Eye) toggle. Severity help text explains escalation. Selecting a unary operator clears any stale `value`/`compareField`.

### Portal Tracker — Selective Vision Re-Verification
- **Purpose**: Re-check a flagged field mismatch or rule violation against the ACTUAL source document with a vision model — closes the text-only blind spot where extraction missed a value or a layout/visual rule can't be judged from flattened fields.
- **Opt-in**: per-field `TemplateField.verifyWithVision` and per-rule `BusinessRule.verifyWithVision` (Eye toggle in the editors). Only fires on violations/mismatches.
- **Verifier**: `verifyWithVision()` in `src/lib/ai/vision-verify.ts` — multimodal call (Anthropic image+PDF, Gemini image+PDF, OpenAI image-only; PDF on OpenAI → UNCERTAIN). Best-effort: returns `{verdict: CONFIRMED|REFUTED|UNCERTAIN, explanation}`, never throws.
- **Orchestrator**: `runVisionChecks()` in `src/lib/ai/vision-checks.ts` — builds a bounded work list (max 4/item), pre-fetches unique file buffers (seeded with `preloadedBuffers` from extraction to avoid re-download), runs verifications **in parallel** (`Promise.allSettled`), mutates `comparisonResult` in place, recomputes match/mismatch counts only when a field verdict flips. Field CONFIRMED → MISMATCH becomes MATCH; rule REFUTED → violation cleared to PASS. Verdict stored on the `FieldComparison.visionVerification` / `BusinessRuleResult.visionVerification`.
- **Wiring**: worker passes `downloadedFiles` + `fileBuffers` (returned by `runExtraction`) into `runComparison`; recompare route loads the item's stored `TrackedItemFile`s (graceful no-op if retention-cleaned). Uses the resolved `visionModel`.
- **Display**: `ItemDetailView` shows an Eye verdict chip on field rows and on FWA business-rule alerts, plus a severity badge from `metadata.severity`.

### Portal Tracker — Comparison Response Truncation
- `compareFields()` (`src/lib/ai/comparison.ts`) detects truncation across providers (Anthropic `stop_reason`, OpenAI `finish_reason === "length"`, Gemini `MAX_TOKENS`) and throws `AppError` `AI_RESPONSE_TRUNCATED` instead of parsing incomplete JSON. Full-prompt `max_tokens` is 16384 (basic 4096).

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

### Storage & Retention Cleanup
- **Schedule**: BullMQ repeatable job runs every 24 hours (`src/lib/queue/cleanup-queue.ts`)
- **Retention**: `SCRAPE_RETENTION_DAYS` env var (default 7). Deletes `ScrapeSession` rows older than cutoff — cascades to items, files, events, comparisons, validations
- **Orphan cleanup**: Scans disk for files not in `TrackedItemFile` table, deletes if older than 1 hour
- **Snapshots survive**: `portalDailyMetrics` is NOT deleted by retention cleanup — portal card totals and historical dashboard views are preserved indefinitely
- **Code**: `src/lib/storage/cleanup.ts` — `runRetentionCleanup()`, `runStorageCleanup()`, `runFullCleanup()`

### Portal Tracker — Session Keep-Alive
- **Purpose**: Stop cookie-auth portal sessions from lapsing due to inactivity, and stop IVM prematurely showing "Expiring soon" while the real session is still alive.
- **Schedule**: BullMQ repeatable job every `PORTAL_KEEPALIVE_MINUTES` (default **15**), scheduled + worked in the **detail-worker process** (`src/lib/queue/keepalive-queue.ts`, wired at the bottom of `item-detail-worker.ts` next to storage cleanup). Redis-gated (no Redis → skipped with a warn).
- **Sweep** (`src/lib/playwright/keepalive.ts` `runPortalKeepAlive`): for every portal with a credential carrying cookies, opens a short-lived context (`authenticateWithCookies`, bounded concurrency 2), `goto`s `listPageUrl ?? baseUrl`, runs `isLoginPage()` (same check as `resolveAuth`, so no false "expired"). **Alive** → persists the current (possibly server-refreshed) `context.cookies()` and bumps `cookieExpiresAt` to `now + 48h`. **Login page** → sets `cookieExpiresAt` to the past (marks expired). Network error → caught, no change. Per-portal non-fatal (`Promise.allSettled`).
- **Why 48h, not 24h**: the portal-detail UI's "Expiring soon" (`warn`) threshold is `cookieExpiresAt < now + 24h` (`portal-detail-view.tsx`), and capture sets exactly `now + 24h` — so a 24h refresh would keep showing "Expiring soon". `REFRESH_TTL_MS = 48h` (> the warn threshold) makes a kept-alive session render **"ok"**; if keep-alive stops for >48h it naturally lapses to "expired".
- **Caveat (documented behavior, not a bug)**: a ping resets an *idle* timeout and re-syncs IVM's clock, but cannot defeat a portal's *absolute* session lifetime — in that case the sweep detects the death (login page) and marks expired; cookies must be re-captured. `authExpiredAt` is per-`ScrapeSession` (runtime circuit breaker), so keep-alive signals liveness via the credential's `cookieExpiresAt` instead.
- **Cookie decode**: `decodeCookieData` is exported from `playwright/auth.ts` (encrypted-sentinel + legacy-plaintext formats), reused by both `resolveAuth` and the keep-alive sweep.

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
- **SPA detail page settle**: `scrapeDetailPage()` poll-extracts after `goto()` — it re-runs `extractDetailFields()` every `DETAIL_POLL_INTERVAL_MS` until the result has `>= MIN_DETAIL_FIELDS` populated values or `DETAIL_SETTLE_TIMEOUT_MS` (15s) elapses, then returns the last attempt. Keying on actual extracted content (not an `innerText.length`/structure proxy) avoids the SPA race where the persistent nav shell is present before the claim detail renders (which returned 0 fields and forced a fall back to list data, losing detail-only fields like Claimant/Provider). Counts non-empty VALUES, so a configured-`fieldSelectors` portal whose values haven't rendered keeps polling
- **Discovery retry**: `discoverFields()` retries `scrapeDetailPage()` once if 0 fields returned — handles SPA cold start where first claim type visited gets empty results
- **Click-discovery**: When no `detailLinkSelector` and no `href` links, detect `cursor:pointer` rows → Phase 1: extract data; Phase 2 (post-loop): click first row, wait for URL change via `waitForFunction((orig) => location.href !== orig)`, extract URL pattern, apply to all rows, `goBack()`
- **SPA navigation**: Use `waitForFunction((orig) => location.href !== orig, currentUrl)` — NOT `waitForNavigation()` (SPA routing doesn't fire navigation events)

## Deployment

### Azure VM (Production)

- **Host**: `azureuser@20.198.253.167`
- **Key**: `~/.ssh/id_ed25519`
- **App directory**: `/var/www/ivm`
- **Env file**: `/etc/ivm/.env` (persistent, never overwritten by deploys)
- **URL**: `https://20.198.253.167.nip.io`

#### Always Build on Server

Next.js standalone output (`output: "standalone"`) embeds absolute build-time paths into the React Client Manifest and webpack chunks. Building on CI (GitHub Actions) at `/home/runner/work/ivm/ivm/` and deploying to `/var/www/ivm/` causes SSR failures because module references don't match.

**Rule**: Never ship pre-built `.next/` artifacts from CI. Always upload source code and run `npm run build` on the Azure VM where the app runs.

#### Webpack Build Cache

`.next/cache/webpack/` persists between deploys for faster incremental builds. This is safe because all builds happen at the same path (`/var/www/ivm/`). If the app is ever moved to a different directory or server, run `rm -rf .next/cache` before the first build to avoid stale path entries.

#### Standalone Symlinks After Every Build

Next.js standalone output does not include `static/` or `public/` directories. Two symlinks must exist after every build:

```bash
ln -sfn /var/www/ivm/.next/static .next/standalone/.next/static
ln -sfn /var/www/ivm/public .next/standalone/public
```

Without these, all `/_next/static/*` requests return 404 and the app is unusable.

#### NEXTAUTH_URL Must Match Access URL

`NEXTAUTH_URL` in `/etc/ivm/.env` must exactly match how users access the site — scheme, domain, and port. Currently: `https://20.198.253.167.nip.io`. A mismatch (e.g., `http://` or bare IP) causes auth callback failures.

#### PM2 Process Recovery

If the `ivm` PM2 process enters a restart loop (120+ restarts), delete and recreate it rather than just restarting:

```bash
pm2 delete ivm
pm2 start /etc/ivm/start-app.sh --name ivm
pm2 save
```

Simply restarting a corrupted process preserves stale error state.

#### CRLF Line Endings in Shell Scripts

The deploy script auto-strips Windows CRLF from `scripts/*.sh` after tar extraction (`sed -i 's/\r$//'`). Without this, workers fail with `ERR_MODULE_NOT_FOUND` because `\r` gets appended to file paths (e.g., `portal-worker.ts%0D`).

#### Deploy Commands

```bash
# Manual deploy (builds on server)
bash scripts/deploy.sh azure

# Force deploy during active scrape jobs
bash scripts/deploy.sh azure --force
```

GitHub Actions deploys automatically on push to `main` when relevant paths change.

### Hostinger VPS (Legacy)

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **SSH**: `ssh -i /c/Users/huien/.ssh/id_ed25519 root@72.62.75.247`
- **Database**: Supabase PostgreSQL in Docker on port **5433** (NOT 5432)
- **Login**: `dev@ivm.local / password123`
- **Database name**: `ivm` (NOT `ivm_dev`) — correct `DATABASE_URL`:
  ```
  DATABASE_URL="postgresql://ivm:ivm_dev_password@localhost:5433/ivm?schema=public"
  ```
- Before every deploy: verify VPS `.env` has the correct DATABASE_URL — `grep DATABASE_URL /var/www/ivm/.env`
- **Deploy**: `tar czf` locally → `scp` → `tar xzf` on VPS → `npm run build && pm2 restart ivm`
- **Full deploy**: add `npm ci && npx prisma generate && npx prisma migrate deploy` before build
- **Schema migrations**: `prisma migrate deploy` requires `DATABASE_URL` pointing to port 5433. If the `ivm` user lacks DDL privileges, run migration SQL directly: `docker exec supabase-db psql -U postgres -d ivm -f migration.sql`, then insert into `_prisma_migrations` manually

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
