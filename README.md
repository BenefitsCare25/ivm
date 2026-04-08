# IVM — Intelligent Value Mapper

AI-powered document-to-form autofill platform. Upload a source document, extract fields with AI, map them to any target (webpage, PDF, or DOCX), and fill automatically.

## Features

### Source Ingestion
- Upload images (PNG, JPG, WEBP), PDFs, and DOCX files as source documents
- 10MB file size limit with MIME type validation
- Replace semantics — one source per session, re-upload replaces previous
- Files served securely via authenticated download endpoint

### AI Extraction
- Multi-provider BYOK (Bring Your Own Key): Anthropic Claude, OpenAI GPT-4o, Google Gemini 2.0 Flash
- Extracts structured fields: name, value, field type, confidence score, bounding box
- Field types: TEXT, DATE, NUMBER, PHONE, EMAIL, ADDRESS, NAME, CURRENCY, BOOLEAN, OTHER
- User can edit any extracted field inline after review
- Falls back to system API key if no BYOK key configured

### Target Ingestion
- **Webpage**: fetches URL server-side, detects `<input>`, `<select>`, `<textarea>` elements
- **PDF**: detects AcroForm interactive fields (text, checkbox, dropdown, radio)
- **DOCX**: detects `{{placeholder}}` patterns in Word templates
- Replace semantics — one target per session

### AI Field Mapping
- AI proposes source → target field mappings with confidence scores and rationale
- User reviews, approves, rejects, or edits individual mappings inline
- User can override the mapped value before fill
- Unmapped target fields shown explicitly (sourceFieldId = null)

### Fill Execution
- **PDF**: fills AcroForm fields in-place using pdf-lib, downloadable
- **DOCX**: replaces `{{placeholder}}` text using JSZip XML manipulation, downloadable
- **Webpage**: generates a JavaScript snippet to paste in browser console
- Per-field FillAction tracking: PENDING → APPLIED → VERIFIED (or FAILED / SKIPPED)
- Re-fill support — overwrites previous fill, no duplicates
- Filled PDF/DOCX stored and downloadable via API

### Review & Audit
- Results tab: FillReport summary + per-field status table + download/export buttons
- History tab: SessionTimeline with event icons + SessionMetadata panel (13 fields)
- Full session JSON export (source, extraction, target, mappings, fill actions, audit events)
- Paginated audit event log with event type filtering (capped at 100 per request)
- Session completion marks workflow as COMPLETED

### Auth & Settings
- Email/password registration and sign-in
- GitHub OAuth (optional)
- JWT session strategy (NextAuth v5)
- BYOK API key management: save, validate, delete per provider
- Preferred AI provider setting

### Production Hardening
- Rate limiting: 100 req/min (global), 10 req/min (auth), 5 req/min (AI) per IP/user
- Redis-backed rate limiting with in-memory fallback
- Retry with exponential backoff on transient AI errors (max 2 retries)
- AI timeouts: 60s extraction, 30s mapping, 15s key validation
- Request ID (`X-Request-ID`) on every response
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- Zod env validation at startup — fails fast on missing required vars
- AES-256-GCM encryption for stored API keys
- Graceful shutdown (SIGTERM/SIGINT disconnect Prisma + Redis)
- Error boundaries for unhandled React errors
- Prometheus metrics at `/api/metrics`
- Sentry error tracking (optional)
- OpenAPI spec + Swagger UI at `/docs`

### Storage
- Local filesystem (default) or AWS S3 (configurable via `STORAGE_PROVIDER`)
- Abstracted via `StorageAdapter` interface — swap providers without code changes

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + TypeScript strict mode |
| Database | PostgreSQL 16 via Prisma ORM v6 |
| Styling | Tailwind CSS v4 + CSS custom properties |
| UI | Radix UI primitives |
| Auth | NextAuth v5 (JWT, Credentials + GitHub OAuth) |
| AI | Anthropic Claude, OpenAI GPT-4o, Google Gemini 2.0 Flash |
| Queue | BullMQ + Redis (optional async extraction) |
| Storage | Local filesystem or AWS S3 |
| Logging | Pino (pretty in dev, JSON in prod) |
| Monitoring | Prometheus metrics, Sentry |
| Doc processing | pdf-lib, JSZip, mammoth, cheerio |

---

## Session Workflow

```
SOURCE → EXTRACT → TARGET → MAP → FILL → REVIEW → COMPLETED
```

| Step | Status | Description |
|------|--------|-------------|
| SOURCE | `CREATED` → `SOURCE_UPLOADED` | Upload source document |
| EXTRACT | `SOURCE_UPLOADED` → `EXTRACTED` | AI field extraction |
| TARGET | `EXTRACTED` → `TARGET_SET` | Set fill target (webpage/PDF/DOCX) |
| MAP | `TARGET_SET` → `MAPPED` | AI field mapping + user review |
| FILL | `MAPPED` → `FILLED` | Execute fill, download result |
| REVIEW | `FILLED` → `COMPLETED` | Review results, export, complete |

---

## Local Development

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Setup

```bash
# 1. Copy and fill environment variables
cp .env.example .env

# 2. Generate required secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste as ENCRYPTION_KEY in .env

# 3. Start infrastructure
docker compose up -d          # PostgreSQL + Redis

# 4. Install and migrate
npm install
npx prisma migrate dev
npx prisma db seed            # creates dev@ivm.local / password123

# 5. Start dev server
npm run dev                   # http://localhost:3000
```

### Default Dev Credentials
- Email: `dev@ivm.local`
- Password: `password123`

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_URL` | Yes | App URL (e.g. `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Yes | Min 32-char random string |
| `ENCRYPTION_KEY` | Yes | 64-char hex (32 bytes) for AES-256-GCM |
| `ANTHROPIC_API_KEY` | No | Fallback AI key if no BYOK configured |
| `REDIS_URL` | No | Redis for rate limiting + queue (falls back to in-memory) |
| `STORAGE_PROVIDER` | No | `local` (default) or `s3` |
| `SENTRY_DSN` | No | Sentry error tracking |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) |

### npm Scripts

```bash
npm run dev          # dev server with Turbopack
npm run build        # production build
npm run start        # production server
npm run lint         # ESLint

npm run db:generate  # generate Prisma client
npm run db:migrate   # run migrations
npm run db:push      # push schema (no migration file)
npm run db:seed      # seed dev data
npm run db:studio    # Prisma Studio UI
```

---

## API Reference

Full interactive docs available at `/docs` (Swagger UI) or `/docs/openapi.json` (OpenAPI 3.x spec).

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (DB latency) |
| GET | `/api/metrics` | Prometheus metrics |
| POST | `/api/auth/register` | User registration |
| GET/POST | `/api/sessions` | List / create sessions |
| GET/PATCH | `/api/sessions/[id]` | Get / update session |
| POST | `/api/sessions/[id]/upload` | Upload source document |
| POST | `/api/sessions/[id]/extract` | Trigger AI extraction |
| GET | `/api/sessions/[id]/extraction` | Get extracted fields |
| PATCH | `/api/sessions/[id]/extraction/[id]` | Edit extracted field |
| GET/POST/DELETE | `/api/sessions/[id]/target` | Manage fill target |
| GET/POST | `/api/sessions/[id]/mapping` | Fetch / propose field mappings |
| PATCH | `/api/sessions/[id]/mapping/[id]` | Accept / review mapping |
| GET/POST | `/api/sessions/[id]/fill` | Get fill status / execute fill |
| GET | `/api/sessions/[id]/fill/download` | Download filled document |
| POST | `/api/sessions/[id]/complete` | Mark session complete |
| GET | `/api/sessions/[id]/export` | Export full session JSON |
| GET | `/api/sessions/[id]/audit-events` | Paginated audit log |
| GET/POST | `/api/settings/api-keys` | List / save BYOK API keys |
| DELETE | `/api/settings/api-keys/[provider]` | Delete API key |
| PUT | `/api/settings/preferred-provider` | Set preferred AI provider |
| GET | `/api/files/[key]` | Download uploaded file |

---

## Deployment (VPS)

- **VPS**: Hostinger VPS 2 (`72.62.75.247`), Ubuntu 24.04, 8GB RAM
- **Database**: Supabase PostgreSQL 15.8 in Docker on port 5433
- **Process**: PM2 (`ivm`) on port 3001
- **Proxy**: nginx → 443 → 3001 (self-signed SSL)

```bash
# Deploy
tar czf /tmp/ivm-deploy.tar.gz \
  --exclude='node_modules' --exclude='.next' \
  --exclude='uploads' --exclude='.env' --exclude='.git' .

scp -i ~/.ssh/id_ed25519 /tmp/ivm-deploy.tar.gz root@72.62.75.247:/tmp/

ssh -i ~/.ssh/id_ed25519 root@72.62.75.247 \
  "cd /var/www/ivm && tar xzf /tmp/ivm-deploy.tar.gz \
   && npm ci && npx prisma generate && rm -rf .next && npm run build \
   && pm2 restart ivm --update-env"
```

---

## Testing

See [`docs/superpowers/plans/2026-04-08-ivm-testing-guide.md`](docs/superpowers/plans/2026-04-08-ivm-testing-guide.md) for the full production testing guide covering all 8 phases, database integrity checks, constraint tests, and end-to-end workflow verification.

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Production Foundation (auth, health, security headers, env validation) | Deployed |
| 2 | Source Ingestion & AI Extraction (upload, BYOK, multi-provider) | Deployed |
| 3 | Target Ingestion (webpage/PDF/DOCX inspection) | Deployed |
| 4 | AI Field Mapping (propose, review, inline edit, override) | Deployed |
| 5 | Fill Execution & Verification (PDF/DOCX/webpage, download) | Deployed |
| 6 | Review UX, History & Audit (timeline, export, completion) | Deployed |
| 7 | Production Hardening (rate limiting, retry, timeouts, graceful shutdown) | Deployed |
| 8 | Deferred Features (Redis, S3, BullMQ, Sentry, Prometheus, OpenAPI) | Deployed |
