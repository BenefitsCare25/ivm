# IVM — Intelligent Value Mapper

AI-powered document-to-form autofill platform.

## Project Overview

Users upload a source document/image, AI extracts fields, user selects a target (webpage, interactive PDF, or DOCX template), AI proposes field mappings with rationale, system fills the target with verification, and user reviews before final action.

The AI model is the primary intelligence layer — not hardcoded templates. But the UX must be transparent, review-first, and never pretend certainty.

## Tech Stack

- **Framework**: Next.js 15 (App Router) + TypeScript (strict mode)
- **Database**: PostgreSQL 16 via Prisma ORM (pinned to v6.x)
- **Styling**: Tailwind CSS v4 with `@theme inline` + CSS custom properties (RGB channel values)
- **UI**: Radix UI primitives, shadcn-style component pattern
- **Auth**: NextAuth v5 (`next-auth@beta`), JWT strategy, Credentials + GitHub OAuth
- **Logging**: Pino (pino-pretty in dev, JSON in prod)
- **Storage**: Abstracted via `StorageAdapter` interface (local/S3)
- **AI**: Multi-provider BYOK — Anthropic Claude (`@anthropic-ai/sdk`), OpenAI GPT-4o (`openai`), Google Gemini 2.0 Flash (`@google/generative-ai`)
- **Dev infra**: Docker Compose (PostgreSQL 16 + Redis 7)

## Critical Constraints

### Prisma v6 — Do NOT upgrade to v7
Prisma 7 removed `url` from schema datasource. Our `prisma/schema.prisma` uses `url = env("DATABASE_URL")` which is v6 syntax. Upgrading to v7 requires migrating to `prisma.config.ts` — do this only as a planned task, not as a drive-by upgrade.

### NextAuth v5 beta
Install as `next-auth@beta`, not `next-auth@5` (no stable v5 on npm). The session model is named `AuthSession` in Prisma to avoid conflict with our `FillSession` model.

### BYOK API Key Storage
User API keys are encrypted with AES-256-GCM (`src/lib/crypto.ts`) using `ENCRYPTION_KEY` env var (32-byte hex). The `UserApiKey` model has a `@@unique([userId, provider])` constraint — one key per provider per user, upsert semantics. Never store plaintext keys; always use `encrypt()`/`decrypt()` from `@/lib/crypto`. The extraction route (`src/app/api/sessions/[id]/extract/route.ts`) resolves the user's preferred provider and key via `resolveProviderAndKey()`, falling back to system `ANTHROPIC_API_KEY` if no BYOK keys exist.

### CSS Variables with RGB Channels
All color tokens in `src/styles/tokens.css` use RGB channel values (e.g., `--background: 255 255 255`) so Tailwind opacity modifiers work (e.g., `bg-background/50`). Never use hex values in token definitions.

## Architecture Patterns

### API Routes
- Use `errorResponse()` from `@/lib/errors` in catch blocks — handles `AppError` subclasses automatically
- Throw `UnauthorizedError`, `NotFoundError`, `ValidationError` instead of manual `NextResponse.json` error responses
- Use `updateMany`/`deleteMany` with ownership `where` clause for PATCH/DELETE — avoids TOCTOU race conditions

### Session Data Model
- Product sessions are `FillSession` (not `Session` — that's NextAuth's)
- Steps: `SOURCE → EXTRACT → TARGET → MAP → FILL → REVIEW`
- Step metadata lives in `src/types/session.ts`: `SESSION_STEPS`, `STEP_LABELS`, `STEP_ROUTES`, `STEP_DESCRIPTIONS`
- Session types: use `SessionSummary` from `src/types/session.ts` — don't re-declare inline

### Storage
- Always use `getStorageAdapter()` from `@/lib/storage` — it's a cached singleton
- Never hardcode `fs` operations for file storage

### AI Extraction (BYOK Multi-Provider)
- Unified entry point: `extractFieldsFromDocument()` from `src/lib/ai/index.ts` — dispatches to provider-specific adapters
- Provider adapters: `src/lib/ai/anthropic.ts`, `src/lib/ai/openai.ts`, `src/lib/ai/gemini.ts`
- Shared response parser: `src/lib/ai/parse.ts` — all providers return same JSON format
- Prompts in `src/lib/ai/prompts.ts` — shared across all providers
- Types: `AIProvider`, `AIExtractionRequest`, `AIExtractionResponse` in `src/lib/ai/types.ts`
- Key validation: `src/lib/ai/validate-key.ts` — makes minimal API call to test key before saving
- User API keys stored encrypted (AES-256-GCM) in `user_api_keys` table via `src/lib/crypto.ts`
- Fallback: if user has no BYOK keys, uses system `ANTHROPIC_API_KEY` env var
- Settings UI: `src/components/settings/api-keys-form.tsx` — manage keys per provider
- Images → base64 content blocks; PDFs → base64 document blocks; DOCX → not yet supported (graceful error)

### File Upload & Validation
- Upload validation: `src/lib/validations/upload.ts` — `ALLOWED_MIME_TYPES`, `MAX_FILE_SIZE` (10MB), `validateUploadFile()`
- MIME icon mapping: `src/lib/mime-icons.ts` — `getMimeIcon()`, `isImageType()`
- File serving: `GET /api/files/:key` decodes storage key, streams via StorageAdapter
- Replace semantics: one source per session — uploading replaces the previous source asset

### Target Inspection
- Three inspection engines in `src/lib/target/`: `inspect-webpage.ts` (cheerio HTML parsing), `inspect-pdf.ts` (pdf-lib AcroForm), `inspect-docx.ts` (mammoth placeholder detection)
- Dispatcher: `inspectTarget(targetType, { url?, buffer? })` from `src/lib/target/inspect.ts`
- WEBPAGE: fetches URL server-side (15s timeout, 2MB limit), extracts `<input>`, `<select>`, `<textarea>` elements
- PDF: detects AcroForm interactive fields (text, checkbox, dropdown, radio, option list)
- DOCX: detects `{{placeholder}}` patterns via regex on extracted text
- Target API: `GET/POST/DELETE /api/sessions/[id]/target` — replace semantics (one target per session), same pattern as source upload
- Target types: `TargetAssetData` in `src/types/target.ts` for client-side representation
- Target step flow: type selector → URL input or file upload → inspect → preview with detected fields table

### AI Field Mapping
- Unified entry point: `proposeFieldMappings()` from `src/lib/ai/mapping.ts` — text-only AI call (no file uploads), dispatches to same provider SDKs as extraction
- Shared provider resolution: `resolveProviderAndKey()` from `src/lib/ai/resolve-provider.ts` — used by both extraction and mapping routes
- Mapping parser: `src/lib/ai/parse-mapping.ts` — validates AI response, creates `FieldMapping[]`, adds unmapped target fields the AI missed
- Prompts: `getMappingSystemPrompt()`, `getMappingUserPrompt()` in `src/lib/ai/prompts.ts`
- Types: `AIMappingRequest`, `AIMappingResponse` in `src/lib/ai/types.ts`; `FieldMapping`, `MappingState` in `src/types/mapping.ts`
- Validation: `reviewMappingSchema` in `src/lib/validations/mapping.ts` (Zod schema for PATCH review)
- API routes: `POST/GET /api/sessions/[id]/mapping` (propose + fetch), `PATCH /api/sessions/[id]/mapping/[mappingSetId]` (accept review)
- `MappingSet` model: status lifecycle `PROPOSED → ACCEPTED`, stores `FieldMapping[]` as JSON
- `FieldMapping.sourceFieldId` is nullable — `null` means unmapped target field (no source match)
- Map step UI: server component fetches data (`map/page.tsx`), client component manages state (`map-step-client.tsx`), review table (`mapping-review-table.tsx`) supports inline editing, approve/reject, approve-all
- `MappingState` type (`"idle" | "processing" | "completed" | "failed"`) maps from Prisma status via `resolveInitialState()` — `"PROPOSED"`/`"ACCEPTED"` both resolve to `"completed"`

### Fill Execution
- Three fillers in `src/lib/fill/`: `pdf-filler.ts` (pdf-lib AcroForm), `docx-filler.ts` (JSZip XML replacement), `webpage-filler.ts` (JS script generation)
- Dispatcher: `executeFill()` from `src/lib/fill/index.ts` — routes by `TargetType`
- `buildFillContext()` filters to approved mappings, resolves intended values (`userOverrideValue ?? transformedValue`)
- Fill + verify runs synchronously in one API call (sub-second for PDF/DOCX, instant for webpage)
- `FillAction` model tracks per-field status: `PENDING → APPLIED → VERIFIED` (or `FAILED`/`SKIPPED`)
- `TargetAsset.filledStoragePath` stores the filled PDF/DOCX in storage
- Webpage fills produce a JS snippet with three delivery methods: (1) "Open Target & Copy" button opens URL + copies script to clipboard, (2) draggable bookmarklet for bookmark bar, (3) Chrome Extension for one-click fill (supports login-required pages)
- Chrome Extension: `extension/` directory, Manifest V3, uses `externally_connectable` API for IVM↔extension messaging. Extension detection + messaging via `src/lib/extension.ts`. Set `NEXT_PUBLIC_IVM_EXTENSION_ID` in env after loading unpacked extension.
- Re-fill support: POST to fill API deletes existing FillActions and overwrites filledStoragePath
- DOCX caveat: placeholders split across XML formatting runs will fail — must be contiguous `{{placeholder}}` text

### Session Completion
- `POST /api/sessions/[id]/complete` — transitions `FILLED → COMPLETED`
- Review step has two tabs: **Results** (FillReport + FillActionsTable + download/export buttons + Complete Session button) and **History** (SessionTimeline + SessionMetadata)
- `GET /api/sessions/[id]/export` — returns full session JSON as attachment download (`Content-Disposition: attachment`)
- `GET /api/sessions/[id]/audit-events` — paginated audit events; Zod-validated `limit`/`offset`/`eventType` query params; capped at 100 events
- Review page server component (`src/app/(dashboard)/sessions/[id]/review/page.tsx`) fetches audit events with `take: 100`

### Audit Events
- `AuditEventSummary` interface, `getEventLabel()`, `getEventIconName()`, `formatPayloadSummary()` all in `src/types/audit.ts` — single source of truth for audit event display logic
- `SessionTimeline` component (`src/components/sessions/session-timeline.tsx`) renders vertical timeline; uses `ICON_MAP` record + `getEventIconName()` for icon lookup
- `SessionMetadata` component (`src/components/sessions/session-metadata.tsx`) — 13-field summary panel; exports `SessionMetadataProps`
- `ReviewTabs` component (`src/components/sessions/review-tabs.tsx`) — client-side tab switcher; accepts `resultsContent` and `historyContent` as `React.ReactNode`

### Shared Type Sources of Truth
- `src/types/extraction.ts`: `FIELD_TYPES`, `FieldType`, `ExtractedField`, `ExtractionState`, `SourceAssetData`
- `src/types/target.ts`: `TargetType`, `TargetField`, `TargetAssetData`, `TargetAssetSummary`
- `src/types/mapping.ts`: `FieldMapping`, `MappingSetSummary`, `MappingState`
- `src/types/fill.ts`: `FillActionStatus`, `FillState`, `FillActionSummary`, `FillReport`, `FillSessionData` + helpers `buildFillReport()`, `toFillActionSummary()`
- `src/types/audit.ts`: `AuditEventSummary` + display helpers `getEventLabel()`, `getEventIconName()`, `formatPayloadSummary()`
- `src/types/session.ts`: `SessionDetailSummary` extends `SessionSummary` with `sourceFileName`, `sourceMimeType`, `targetType`, `targetName`, `extractedFieldCount` — used by dashboard list
- Never redeclare these types locally in components — always import from the shared module

### Prisma JSON Fields
- When writing typed arrays/objects to Prisma `Json` fields, wrap with `JSON.parse(JSON.stringify(...))` to strip class instances and satisfy Prisma's `InputJsonValue` type

### Production Hardening
- **Env validation**: `src/lib/env.ts` — Zod schema validates all env vars at startup, imported by `db.ts` for early fail-fast
- **Rate limiting**: `src/lib/rate-limit.ts` — in-memory sliding window; `globalLimiter` (100/min per IP), `authLimiter` (10/min per IP), `aiLimiter` (5/min per user); applied in `middleware.ts`
- **Retry**: `src/lib/retry.ts` — `withRetry(fn, opts)` with exponential backoff, max 2 retries on transient errors (429, 500, 502, 503); wraps all AI extraction and mapping calls
- **Request ID**: `middleware.ts` generates `X-Request-ID` (crypto.randomUUID) on every request, forwarded to route handlers via request headers
- **Health check**: `GET /api/health` — pings DB, returns status/uptime/latency; excluded from auth middleware
- **Security headers**: `next.config.ts` `headers()` — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **AI timeouts**: 60s extraction, 30s mapping, 15s key validation; Anthropic/OpenAI use `{ signal: AbortSignal.timeout() }` in options; Gemini uses `Promise.race` with timeout
- **Error boundaries**: `src/app/error.tsx` (root) + `src/app/(dashboard)/error.tsx` (dashboard) — catch unhandled React errors
- **Graceful shutdown**: `src/lib/db.ts` — SIGTERM/SIGINT handlers disconnect Prisma in production
- **Seed protection**: `prisma/seed.ts` exits if `NODE_ENV=production`

### Shared Utilities (`src/lib/utils.ts`)
- `cn()` — className merging (clsx + tailwind-merge)
- `formatDate()` — date formatting (en-SG locale)
- `sanitizeFileName()` — strip unsafe chars from filenames (used by upload + target routes)
- `formatFieldLabel()` — convert field names to human labels (used by all target inspectors)
- `confidenceVariant()` — maps confidence score to badge variant (`"success"` / `"warning"` / `"error"`), used by extraction-table and mapping-review-table

### UI Components
- Error alerts in forms: use `<FormError message={error} />` from `@/components/ui/form-error`
- All components use `cn()` from `@/lib/utils` for className merging
- Follow existing shadcn-style patterns in `src/components/ui/`

### RSC Serialization — Lucide Icons
- **Never pass Lucide icon components as props from Server Components to Client Components** — functions cannot serialize across the RSC boundary
- `EmptyState` accepts `icon` as `React.ReactNode` (pre-rendered JSX), not `LucideIcon` (component function)
- Correct: `<EmptyState icon={<FileText className="h-6 w-6 text-muted-foreground" />} />`
- Wrong: `<EmptyState icon={FileText} />`
- If a Server Component must pass icons to a Client Component, either make the parent a Client Component (like `Sidebar`) or pass pre-rendered `<Icon />` elements

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Production Foundation | Deployed |
| 2 | Source Ingestion & AI Extraction | Deployed |
| 3 | Target Ingestion (Web/PDF/DOCX) | Deployed |
| 4 | AI Field Understanding & Mapping | Deployed |
| 5 | Fill Actions & Verification | Deployed |
| 6 | Review UX, History & Audit | Deployed |
| 7 | Production Hardening | Deployed |
| 8 | Deferred Features (Redis, S3, DOCX, BullMQ, Sentry, Metrics, OpenAPI) | Deployed |
| 9 | AI Accuracy + Webpage Fill UX + Chrome Extension | Deployed |

## Plan Documents

Detailed implementation plans live in `docs/superpowers/plans/`. Write a plan before starting each phase.

- Phase 1: `docs/superpowers/plans/2026-04-07-ivm-phase1-foundation.md`
- Phase 2: `docs/superpowers/plans/2026-04-07-ivm-phase2-source-extraction.md`
- Phase 3: `docs/superpowers/plans/2026-04-07-ivm-phase3-target-ingestion.md`
- Phase 4: `docs/superpowers/plans/2026-04-07-ivm-phase4-field-mapping.md` (plan file at `C:\Users\huien\.claude-work\plans\wise-nibbling-church.md`)
- Phase 5: `docs/superpowers/plans/2026-04-08-ivm-phase5-fill-verification.md`
- Phase 6: `docs/superpowers/plans/2026-04-08-ivm-phase6-review-history-audit.md`
- Phase 7: `docs/superpowers/plans/2026-04-08-ivm-phase7-production-hardening.md`
- Phase 8: `docs/superpowers/plans/2026-04-08-ivm-phase8-deferred-features.md`

## Deployment

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **URL**: `https://72.62.75.247` (self-signed cert — needs domain + Let's Encrypt for proper SSL)
- **Database**: Supabase PostgreSQL 15.8 in Docker on port 5433
- **Process**: PM2 (`ivm`) on port 3001, nginx proxies 443 → 3001
- **Login**: `dev@ivm.local / password123`
- **Deploy**: `tar czf` → `scp` → extract → `npm ci && npx prisma generate && npm run build && pm2 restart ivm`
- **Pending**: No domain/proper SSL, no git repo

## Development Setup

```bash
cp .env.example .env        # then set NEXTAUTH_SECRET and ENCRYPTION_KEY
docker compose up -d         # PostgreSQL + Redis
npx prisma generate          # generate Prisma client
npx prisma migrate dev       # create tables
npx prisma db seed           # dev user: dev@ivm.local / password123
npm run dev                  # http://localhost:3000
```

Generate `ENCRYPTION_KEY` with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## File Organization

```
src/
  app/                    # Next.js App Router pages and API routes
    (auth)/               # Sign-in, sign-up pages
    (dashboard)/          # Main app pages (protected)
    api/                  # API routes
      files/[key]/        # File serving endpoint
      settings/
        api-keys/         # BYOK key management (GET/POST)
        api-keys/[provider]/ # Delete key (DELETE)
        preferred-provider/  # Set preferred AI provider (PUT)
      sessions/[id]/
        upload/           # Source file upload (POST)
        extract/          # Trigger AI extraction (POST, uses BYOK key)
        extraction/       # Get extraction results (GET)
        extraction/[extractionId]/ # Edit fields (PATCH)
        target/           # Target CRUD (GET/POST/DELETE)
        mapping/          # AI mapping propose + fetch (POST/GET)
        mapping/[mappingSetId]/ # Accept mapping review (PATCH)
        fill/             # Execute fill (POST) + fetch results (GET)
          download/       # Download filled document (GET)
        complete/         # Mark session completed (POST)
        audit-events/     # Paginated audit event history (GET)
        export/           # Full session JSON export download (GET)
  components/
    ui/                   # Reusable primitives (button, card, input, etc.)
    auth/                 # Auth-specific components
    layout/               # Shell, sidebar, header
    sessions/             # Session-specific components (upload, preview, extraction table, target selection, mapping review, step clients, use-download-fill hook, session-timeline, session-metadata, review-tabs)
    settings/             # Settings components (api-keys-form)
  lib/                    # Core utilities and services
    ai/                   # Multi-provider AI extraction + mapping (index, anthropic, openai, gemini, mapping, parse, parse-mapping, resolve-provider, validate-key, prompts, types)
    fill/                 # Fill execution engines (PDF/DOCX/webpage)
    target/               # Target inspection engines (webpage/PDF/DOCX)
    storage/              # Storage adapter abstraction
    validations/          # Zod schemas (session, upload, extraction, target, mapping, fill, api-key, audit)
  styles/                 # CSS tokens and globals
  types/                  # TypeScript type definitions (session, extraction, target, mapping, fill, audit)
prisma/                   # Schema and seed
docs/superpowers/plans/   # Implementation plans
extension/                # Chrome Extension (Manifest V3) for webpage auto-fill
```
