# IVM Phase 1 -- Production Foundation

**Date**: 2026-04-07
**Status**: Planning
**Author**: System Architect Agent

---

## Product Overview

IVM (Intelligent Value Mapper) is an AI-powered document-to-form autofill platform. Users upload a source document, AI extracts structured fields, and the system fills target forms (webpages, interactive PDFs, or DOCX templates) with human-in-the-loop verification.

---

## Phase Roadmap

| Phase | Name | Scope | Dependencies |
|-------|------|-------|--------------|
| **1** | Production Foundation | Repo, app shell, design system, auth, DB schema, session model, dashboard, create-session flow, Docker, migrations, env config | None |
| **2** | Source Ingestion & AI Extraction | File upload, clipboard paste, storage abstraction, AI extraction pipeline, extracted-data review screen | Phase 1 |
| **3** | Target Ingestion | Target selection UX, Browser Workspace architecture, PDF inspection, DOCX inspection, unsupported-target messaging | Phase 1, Phase 2 |
| **4** | AI Mapping | Target field understanding, AI-proposed mappings with rationale, mapping review screen | Phase 2, Phase 3 |
| **5** | Fill Actions | Web text/select fill, AcroForm fill, content control fill, post-fill verification | Phase 4 |
| **6** | Review UX & Auditability | Session timeline, action log, diff preview, export/download, history, compliance hooks | Phase 5 |
| **7** | Production Hardening | Background jobs, rate limiting, error handling, logging, tests, fixtures | All prior |

**Dependency graph:**

```
Phase 1 ──┬──> Phase 2 ──┬──> Phase 4 ──> Phase 5 ──> Phase 6 ──> Phase 7
           └──> Phase 3 ──┘
```

---

## Phase 1 Scope

After Phase 1 a developer can:
- Run the app locally with `docker-compose up` + `npm run dev`
- Sign in with email/password or GitHub OAuth
- See a dashboard with empty state
- Create a new session (which starts the step-based workflow)
- See session detail with step indicators (Source, Extract, Target, Map, Fill, Review)
- Navigate session steps (all showing "not started" placeholder states)

Phase 1 delivers zero AI, zero file processing. It is pure infrastructure and UX shell.

---

## Task Breakdown

### Task 1 -- Project Init & Config Files

- [ ] **1.1** Initialize npm project and install dependencies
- [ ] **1.2** Create `tsconfig.json`
- [ ] **1.3** Create `next.config.ts`
- [ ] **1.4** Create `.env.example`
- [ ] **1.5** Create `docker-compose.yml`
- [ ] **1.6** Create `Dockerfile`
- [ ] **1.7** Create `.gitignore`
- [ ] **1.8** Create `README.md`

---

#### 1.1 -- Initialize npm project and install dependencies

```bash
cd IVM
npm init -y
npm install next@15 react@19 react-dom@19 typescript @types/react @types/react-dom @types/node
npm install tailwindcss@4 @tailwindcss/postcss postcss
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-slot @radix-ui/react-avatar @radix-ui/react-tooltip
npm install next-auth@5 @auth/prisma-adapter
npm install prisma @prisma/client
npm install bcryptjs @types/bcryptjs
npm install zod
npm install pino pino-pretty
npm install clsx tailwind-merge
npm install lucide-react
npm install class-variance-authority
```

Update `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio",
    "lint": "next lint"
  },
  "prisma": {
    "seed": "npx tsx prisma/seed.ts"
  }
}
```

---

#### 1.2 -- tsconfig.json

```jsonc
// IVM/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

#### 1.3 -- next.config.ts

```ts
// IVM/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
```

---

#### 1.4 -- .env.example

```bash
# IVM/.env.example

# Database
DATABASE_URL="postgresql://ivm:ivm_dev_password@localhost:5432/ivm_dev?schema=public"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="replace-with-a-random-secret-at-least-32-chars"

# GitHub OAuth (optional for dev)
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# Storage
STORAGE_PROVIDER="local"
STORAGE_LOCAL_PATH="./uploads"
# S3_BUCKET=""
# S3_REGION=""
# S3_ACCESS_KEY_ID=""
# S3_SECRET_ACCESS_KEY=""

# AI Provider (Phase 2+)
# AI_PROVIDER="anthropic"
# ANTHROPIC_API_KEY=""

# Redis (Phase 7+)
REDIS_URL="redis://localhost:6379"

# Feature Flags
FEATURE_BROWSER_WORKSPACE="false"
FEATURE_PDF_FILL="false"
FEATURE_DOCX_FILL="false"

# Logging
LOG_LEVEL="debug"
```

---

#### 1.5 -- docker-compose.yml

```yaml
# IVM/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    container_name: ivm-postgres
    environment:
      POSTGRES_USER: ivm
      POSTGRES_PASSWORD: ivm_dev_password
      POSTGRES_DB: ivm_dev
    ports:
      - "5432:5432"
    volumes:
      - ivm_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ivm -d ivm_dev"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: ivm-redis
    ports:
      - "6379:6379"
    volumes:
      - ivm_redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  ivm_pgdata:
  ivm_redisdata:
```

---

#### 1.6 -- Dockerfile

```dockerfile
# IVM/Dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

Update `next.config.ts` to support standalone output for Docker:

```ts
// IVM/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
```

---

#### 1.7 -- .gitignore

```gitignore
# IVM/.gitignore
node_modules/
.next/
out/
dist/
.env
.env.local
.env.production
*.tsbuildinfo
next-env.d.ts
uploads/
*.log
.DS_Store
```

---

#### 1.8 -- README.md

```md
# IVM -- Intelligent Value Mapper

AI-powered document-to-form autofill platform.

## Local Development

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Setup

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

2. Start infrastructure:
   ```bash
   docker-compose up -d
   ```

3. Install dependencies and setup database:
   ```bash
   npm install
   npx prisma migrate dev
   npx prisma db seed
   ```

4. Run the dev server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

### Default Credentials (dev seed)
- Email: `dev@ivm.local`
- Password: `password123`
```

**Verification**: `npm run dev` starts without errors (will fail until layout files exist -- expected at this step).

---

### Task 2 -- Database Schema & Prisma

- [ ] **2.1** Initialize Prisma
- [ ] **2.2** Write the full schema
- [ ] **2.3** Write the seed file
- [ ] **2.4** Run migration

---

#### 2.1 -- Initialize Prisma

```bash
npx prisma init
```

This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env`.

---

#### 2.2 -- Full Prisma Schema

```prisma
// IVM/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ──────────────────────────────────────────────
// Auth models (NextAuth v5 / Auth.js)
// ──────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  passwordHash  String?
  image         String?
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts     Account[]
  authSessions AuthSession[]
  fillSessions FillSession[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model AuthSession {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("auth_sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

// ──────────────────────────────────────────────
// Domain models
// ──────────────────────────────────────────────

enum FillSessionStatus {
  CREATED
  SOURCE_UPLOADED
  EXTRACTED
  TARGET_SET
  MAPPED
  FILLED
  REVIEWED
  COMPLETED
  FAILED
}

enum SessionStep {
  SOURCE
  EXTRACT
  TARGET
  MAP
  FILL
  REVIEW
}

enum ExtractionStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum TargetType {
  WEBPAGE
  PDF
  DOCX
}

enum MappingStatus {
  PROPOSED
  REVIEWED
  ACCEPTED
}

enum FillActionStatus {
  PENDING
  APPLIED
  VERIFIED
  FAILED
  SKIPPED
}

model FillSession {
  id          String            @id @default(cuid())
  userId      String
  title       String
  description String?
  status      FillSessionStatus @default(CREATED)
  currentStep SessionStep       @default(SOURCE)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceAssets      SourceAsset[]
  extractionResults ExtractionResult[]
  targetAssets      TargetAsset[]
  mappingSets       MappingSet[]
  fillActions       FillAction[]
  auditEvents       AuditEvent[]

  @@index([userId])
  @@map("fill_sessions")
}

model SourceAsset {
  id              String   @id @default(cuid())
  fillSessionId   String
  fileName        String
  originalName    String
  mimeType        String
  sizeBytes       Int
  storagePath     String
  storageProvider String   @default("local")
  uploadedAt      DateTime @default(now())

  fillSession       FillSession        @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  extractionResults ExtractionResult[]

  @@index([fillSessionId])
  @@map("source_assets")
}

model ExtractionResult {
  id            String           @id @default(cuid())
  fillSessionId String
  sourceAssetId String
  provider      String           @default("anthropic")
  rawResponse   Json?
  documentType  String?
  fields        Json             @default("[]")
  status        ExtractionStatus @default(PENDING)
  startedAt     DateTime?
  completedAt   DateTime?
  errorMessage  String?

  fillSession FillSession @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  sourceAsset SourceAsset @relation(fields: [sourceAssetId], references: [id], onDelete: Cascade)
  mappingSets MappingSet[]

  @@index([fillSessionId])
  @@map("extraction_results")
}

model TargetAsset {
  id                String     @id @default(cuid())
  fillSessionId     String
  targetType        TargetType
  url               String?
  fileName          String?
  storagePath       String?
  detectedFields    Json       @default("[]")
  isSupported       Boolean    @default(true)
  unsupportedReason String?
  inspectedAt       DateTime?

  fillSession FillSession  @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  mappingSets MappingSet[]

  @@index([fillSessionId])
  @@map("target_assets")
}

model MappingSet {
  id                 String        @id @default(cuid())
  fillSessionId      String
  extractionResultId String
  targetAssetId      String
  mappings           Json          @default("[]")
  status             MappingStatus @default(PROPOSED)
  proposedAt         DateTime      @default(now())
  reviewedAt         DateTime?

  fillSession      FillSession      @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  extractionResult ExtractionResult @relation(fields: [extractionResultId], references: [id], onDelete: Cascade)
  targetAsset      TargetAsset      @relation(fields: [targetAssetId], references: [id], onDelete: Cascade)
  fillActions      FillAction[]

  @@index([fillSessionId])
  @@map("mapping_sets")
}

model FillAction {
  id             String           @id @default(cuid())
  fillSessionId  String
  mappingSetId   String
  targetFieldId  String
  intendedValue  String
  appliedValue   String?
  verifiedValue  String?
  status         FillActionStatus @default(PENDING)
  appliedAt      DateTime?
  verifiedAt     DateTime?
  errorMessage   String?

  fillSession FillSession @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)
  mappingSet  MappingSet  @relation(fields: [mappingSetId], references: [id], onDelete: Cascade)

  @@index([fillSessionId])
  @@index([mappingSetId])
  @@map("fill_actions")
}

model AuditEvent {
  id            String   @id @default(cuid())
  fillSessionId String
  eventType     String
  actor         String   @default("SYSTEM")
  payload       Json     @default("{}")
  timestamp     DateTime @default(now())

  fillSession FillSession @relation(fields: [fillSessionId], references: [id], onDelete: Cascade)

  @@index([fillSessionId])
  @@index([timestamp])
  @@map("audit_events")
}
```

---

#### 2.3 -- Seed File

```ts
// IVM/prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  await prisma.user.upsert({
    where: { email: "dev@ivm.local" },
    update: {},
    create: {
      email: "dev@ivm.local",
      name: "Dev User",
      passwordHash,
    },
  });

  console.log("Seed complete: dev@ivm.local / password123");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
```

---

#### 2.4 -- Run migration

```bash
docker-compose up -d postgres
npx prisma migrate dev --name init
npx prisma db seed
```

**Verification**: `npx prisma studio` opens and shows all tables. The `User` table has one row (dev@ivm.local).

---

### Task 3 -- Core Library Files

- [ ] **3.1** Prisma client singleton
- [ ] **3.2** Structured logger
- [ ] **3.3** App error classes
- [ ] **3.4** Feature flags
- [ ] **3.5** Storage abstraction
- [ ] **3.6** Validation schemas
- [ ] **3.7** Domain types
- [ ] **3.8** Utility: cn()

---

#### 3.1 -- Prisma Client Singleton

```ts
// IVM/src/lib/db.ts
import { PrismaClient } from "@prisma/client";

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
```

---

#### 3.2 -- Structured Logger

```ts
// IVM/src/lib/logger.ts
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
```

---

#### 3.3 -- App Error Classes

```ts
// IVM/src/lib/errors.ts

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(msg, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string,
    fieldErrors: Record<string, string[]> = {}
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}
```

---

#### 3.4 -- Feature Flags

```ts
// IVM/src/lib/features.ts

type FeatureFlag =
  | "BROWSER_WORKSPACE"
  | "PDF_FILL"
  | "DOCX_FILL";

const defaults: Record<FeatureFlag, boolean> = {
  BROWSER_WORKSPACE: false,
  PDF_FILL: false,
  DOCX_FILL: false,
};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const envKey = `FEATURE_${flag}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined) {
    return envVal === "true" || envVal === "1";
  }
  return defaults[flag];
}
```

---

#### 3.5 -- Storage Abstraction

```ts
// IVM/src/lib/storage/index.ts

export interface StorageAdapter {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}

export function getStorageAdapter(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  switch (provider) {
    case "local": {
      const { LocalStorageAdapter } = require("./local");
      return new LocalStorageAdapter();
    }
    case "s3": {
      const { S3StorageAdapter } = require("./s3");
      return new S3StorageAdapter();
    }
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}
```

```ts
// IVM/src/lib/storage/local.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./index";

const BASE_DIR = process.env.STORAGE_LOCAL_PATH ?? "./uploads";

export class LocalStorageAdapter implements StorageAdapter {
  private async ensureDir(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(BASE_DIR, key);
    await this.ensureDir(filePath);
    await fs.writeFile(filePath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = path.join(BASE_DIR, key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(BASE_DIR, key);
    await fs.unlink(filePath).catch(() => {});
  }

  async getUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
```

```ts
// IVM/src/lib/storage/s3.ts
import type { StorageAdapter } from "./index";

export class S3StorageAdapter implements StorageAdapter {
  async upload(_key: string, _data: Buffer, _contentType: string): Promise<string> {
    throw new Error("S3 adapter not implemented. Configure in Phase 2+.");
  }

  async download(_key: string): Promise<Buffer> {
    throw new Error("S3 adapter not implemented.");
  }

  async delete(_key: string): Promise<void> {
    throw new Error("S3 adapter not implemented.");
  }

  async getUrl(_key: string): Promise<string> {
    throw new Error("S3 adapter not implemented.");
  }
}
```

---

#### 3.6 -- Validation Schemas

```ts
// IVM/src/lib/validations/session.ts
import { z } from "zod";

export const createSessionSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be under 200 characters"),
  description: z
    .string()
    .max(1000, "Description must be under 1000 characters")
    .optional()
    .default(""),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
```

---

#### 3.7 -- Domain Types

```ts
// IVM/src/types/session.ts

export const SESSION_STEPS = [
  "SOURCE",
  "EXTRACT",
  "TARGET",
  "MAP",
  "FILL",
  "REVIEW",
] as const;

export type SessionStep = (typeof SESSION_STEPS)[number];

export const STEP_LABELS: Record<SessionStep, string> = {
  SOURCE: "Source",
  EXTRACT: "Extract",
  TARGET: "Target",
  MAP: "Map",
  FILL: "Fill",
  REVIEW: "Review",
};

export const STEP_DESCRIPTIONS: Record<SessionStep, string> = {
  SOURCE: "Upload your source document",
  EXTRACT: "Review extracted fields",
  TARGET: "Select your target form",
  MAP: "Review field mappings",
  FILL: "Execute form fill",
  REVIEW: "Review and approve",
};

export interface SessionSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  currentStep: SessionStep;
  createdAt: string;
  updatedAt: string;
}
```

```ts
// IVM/src/types/extraction.ts

export interface ExtractedField {
  id: string;
  label: string;
  value: string;
  fieldType: "text" | "date" | "number" | "email" | "phone" | "address" | "name" | "currency" | "other";
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  pageNumber?: number;
  rawText?: string;
}

export interface ExtractionResultSummary {
  id: string;
  documentType: string | null;
  fieldCount: number;
  status: string;
  provider: string;
  completedAt: string | null;
}
```

```ts
// IVM/src/types/target.ts

export type TargetType = "WEBPAGE" | "PDF" | "DOCX";

export interface TargetField {
  id: string;
  name: string;
  label: string;
  fieldType: "text" | "textarea" | "select" | "checkbox" | "radio" | "date" | "email" | "number" | "other";
  required: boolean;
  options?: string[];
  currentValue?: string;
  selector?: string;
  pageNumber?: number;
}

export interface TargetAssetSummary {
  id: string;
  targetType: TargetType;
  url: string | null;
  fileName: string | null;
  fieldCount: number;
  isSupported: boolean;
  unsupportedReason: string | null;
}
```

```ts
// IVM/src/types/mapping.ts

export interface FieldMapping {
  id: string;
  sourceFieldId: string;
  targetFieldId: string;
  sourceLabel: string;
  targetLabel: string;
  sourceValue: string;
  transformedValue: string;
  confidence: number;
  rationale: string;
  userApproved: boolean;
  userOverrideValue?: string;
}

export interface MappingSetSummary {
  id: string;
  status: string;
  mappingCount: number;
  proposedAt: string;
  reviewedAt: string | null;
}
```

```ts
// IVM/src/types/fill.ts

export type FillActionStatus = "PENDING" | "APPLIED" | "VERIFIED" | "FAILED" | "SKIPPED";

export interface FillActionSummary {
  id: string;
  targetFieldId: string;
  targetLabel: string;
  intendedValue: string;
  appliedValue: string | null;
  verifiedValue: string | null;
  status: FillActionStatus;
  errorMessage: string | null;
}

export interface FillReport {
  total: number;
  applied: number;
  verified: number;
  failed: number;
  skipped: number;
}
```

---

#### 3.8 -- Utility: cn()

```ts
// IVM/src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
```

---

### Task 4 -- Design System (CSS Variables + Tailwind)

- [ ] **4.1** Create `tokens.css` with CSS custom properties
- [ ] **4.2** Create `globals.css` with Tailwind + token integration
- [ ] **4.3** Create `tailwind.config.ts` mapping CSS vars to Tailwind theme

---

#### 4.1 -- tokens.css

```css
/* IVM/src/styles/tokens.css */

:root {
  /* ── Text ─────────────────────────────── */
  --foreground: 15 23 42;             /* slate-900 */
  --foreground-secondary: 51 65 85;   /* slate-700 */
  --muted-foreground: 100 116 139;    /* slate-500 */

  /* ── Backgrounds ──────────────────────── */
  --background: 255 255 255;          /* white */
  --card: 255 255 255;                /* white */
  --muted: 241 245 249;              /* slate-100 */
  --popover: 255 255 255;

  /* ── Borders ──────────────────────────── */
  --border: 226 232 240;             /* slate-200 */
  --input: 226 232 240;
  --ring: 59 130 246;                /* blue-500 */

  /* ── Accent / Primary ─────────────────── */
  --primary: 37 99 235;             /* blue-600 */
  --primary-foreground: 255 255 255;
  --secondary: 241 245 249;
  --secondary-foreground: 15 23 42;

  /* ── Accent ───────────────────────────── */
  --accent: 241 245 249;
  --accent-foreground: 15 23 42;

  /* ── Destructive ──────────────────────── */
  --destructive: 239 68 68;
  --destructive-foreground: 255 255 255;

  /* ── Radius ───────────────────────────── */
  --radius: 0.5rem;

  /* ── Sidebar ──────────────────────────── */
  --sidebar-bg: 248 250 252;        /* slate-50 */
  --sidebar-foreground: 51 65 85;
  --sidebar-border: 226 232 240;
  --sidebar-accent: 241 245 249;
  --sidebar-accent-foreground: 15 23 42;
  --sidebar-width: 260px;

  /* ── Status ───────────────────────────── */
  --status-success: 34 197 94;
  --status-warning: 245 158 11;
  --status-error: 239 68 68;
  --status-info: 59 130 246;
}

[data-mode="dark"] {
  --foreground: 226 232 240;
  --foreground-secondary: 203 213 225;
  --muted-foreground: 148 163 184;

  --background: 15 23 42;
  --card: 30 41 59;
  --muted: 30 41 59;
  --popover: 30 41 59;

  --border: 51 65 85;
  --input: 51 65 85;
  --ring: 96 165 250;

  --primary: 96 165 250;
  --primary-foreground: 15 23 42;
  --secondary: 51 65 85;
  --secondary-foreground: 226 232 240;

  --accent: 51 65 85;
  --accent-foreground: 226 232 240;

  --destructive: 248 113 113;
  --destructive-foreground: 15 23 42;

  --sidebar-bg: 15 23 42;
  --sidebar-foreground: 203 213 225;
  --sidebar-border: 51 65 85;
  --sidebar-accent: 30 41 59;
  --sidebar-accent-foreground: 226 232 240;
}
```

---

#### 4.2 -- globals.css

```css
/* IVM/src/styles/globals.css */
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-background: rgb(var(--background));
  --color-foreground: rgb(var(--foreground));
  --color-foreground-secondary: rgb(var(--foreground-secondary));
  --color-muted: rgb(var(--muted));
  --color-muted-foreground: rgb(var(--muted-foreground));
  --color-card: rgb(var(--card));
  --color-popover: rgb(var(--popover));
  --color-border: rgb(var(--border));
  --color-input: rgb(var(--input));
  --color-ring: rgb(var(--ring));
  --color-primary: rgb(var(--primary));
  --color-primary-foreground: rgb(var(--primary-foreground));
  --color-secondary: rgb(var(--secondary));
  --color-secondary-foreground: rgb(var(--secondary-foreground));
  --color-accent: rgb(var(--accent));
  --color-accent-foreground: rgb(var(--accent-foreground));
  --color-destructive: rgb(var(--destructive));
  --color-destructive-foreground: rgb(var(--destructive-foreground));
  --color-sidebar-bg: rgb(var(--sidebar-bg));
  --color-sidebar-foreground: rgb(var(--sidebar-foreground));
  --color-sidebar-border: rgb(var(--sidebar-border));
  --color-sidebar-accent: rgb(var(--sidebar-accent));
  --color-sidebar-accent-foreground: rgb(var(--sidebar-accent-foreground));
  --color-status-success: rgb(var(--status-success));
  --color-status-warning: rgb(var(--status-warning));
  --color-status-error: rgb(var(--status-error));
  --color-status-info: rgb(var(--status-info));
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    border-color: theme("colors.border");
  }

  body {
    background-color: theme("colors.background");
    color: theme("colors.foreground");
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

---

#### 4.3 -- tailwind.config.ts

With Tailwind v4, configuration is done inside `globals.css` via `@theme inline` (shown above). No separate `tailwind.config.ts` needed. However, `postcss.config.mjs` is required:

```js
// IVM/postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

**Verification**: The app compiles CSS without errors. Semantic classes like `text-foreground`, `bg-card`, `border-border` are available.

---

### Task 5 -- Auth (NextAuth v5)

- [ ] **5.1** Write NextAuth config
- [ ] **5.2** Create API route handler
- [ ] **5.3** Create auth middleware
- [ ] **5.4** Create sign-in page
- [ ] **5.5** Create sign-up page
- [ ] **5.6** Create auth helpers (server-side session access)

---

#### 5.1 -- NextAuth Config

```ts
// IVM/src/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db) as any,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
```

```ts
// IVM/src/types/next-auth.d.ts
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
```

---

#### 5.2 -- API Route Handler

```ts
// IVM/src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

---

#### 5.3 -- Auth Middleware

```ts
// IVM/middleware.ts
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isAuthenticated = !!req.auth;
  const isAuthPage =
    req.nextUrl.pathname.startsWith("/sign-in") ||
    req.nextUrl.pathname.startsWith("/sign-up");

  if (isAuthPage) {
    if (isAuthenticated) {
      return Response.redirect(new URL("/", req.url));
    }
    return;
  }

  if (!isAuthenticated) {
    return Response.redirect(new URL("/sign-in", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

---

#### 5.4 -- Sign-in Page

```tsx
// IVM/src/app/(auth)/sign-in/page.tsx
import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Sign in to IVM</h1>
          <p className="text-sm text-muted-foreground">
            Intelligent Value Mapper
          </p>
        </div>
        <SignInForm />
      </div>
    </div>
  );
}
```

```tsx
// IVM/src/components/auth/sign-in-form.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleGitHub() {
    await signIn("github", { callbackUrl: "/" });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev@ivm.local"
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGitHub}
      >
        Continue with GitHub
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <a href="/sign-up" className="text-primary hover:underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
```

---

#### 5.5 -- Sign-up Page

```tsx
// IVM/src/app/(auth)/sign-up/page.tsx
import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Create account</h1>
          <p className="text-sm text-muted-foreground">
            Get started with IVM
          </p>
        </div>
        <SignUpForm />
      </div>
    </div>
  );
}
```

```tsx
// IVM/src/components/auth/sign-up-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Registration failed");
      setLoading(false);
      return;
    }

    router.push("/sign-in?registered=true");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          minLength={8}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <a href="/sign-in" className="text-primary hover:underline">
          Sign in
        </a>
      </p>
    </form>
  );
}
```

---

#### 5.6 -- Registration API Route & Auth Helpers

```ts
// IVM/src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { logger } from "@/lib/logger";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db.user.create({
      data: { name, email, passwordHash },
    });

    logger.info({ email }, "User registered");
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "Registration error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

```ts
// IVM/src/lib/auth-helpers.ts
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UnauthorizedError } from "@/lib/errors";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  return session;
}

export async function requireAuthApi() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session;
}
```

**Verification**: Navigate to `/sign-in`, submit dev credentials, get redirected to `/`. Navigate to `/sign-up`, create account, redirect back to sign-in.

---

### Task 6 -- UI Primitives (Design System Components)

- [ ] **6.1** Button
- [ ] **6.2** Input
- [ ] **6.3** Card
- [ ] **6.4** Badge
- [ ] **6.5** Dialog
- [ ] **6.6** Dropdown Menu
- [ ] **6.7** Stepper
- [ ] **6.8** Empty State
- [ ] **6.9** Data Table (minimal)

---

#### 6.1 -- Button

```tsx
// IVM/src/components/ui/button.tsx
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

---

#### 6.2 -- Input

```tsx
// IVM/src/components/ui/input.tsx
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
```

---

#### 6.3 -- Card

```tsx
// IVM/src/components/ui/card.tsx
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-xl border border-border bg-card shadow-sm", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold text-foreground leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

---

#### 6.4 -- Badge

```tsx
// IVM/src/components/ui/badge.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-transparent",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
        outline: "text-foreground",
        success: "bg-status-success/10 text-status-success border-status-success/30",
        warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
        error: "bg-status-error/10 text-status-error border-status-error/30",
        info: "bg-status-info/10 text-status-info border-status-info/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

---

#### 6.5 -- Dialog

```tsx
// IVM/src/components/ui/dialog.tsx
"use client";

import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-xl",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
```

---

#### 6.6 -- Dropdown Menu

```tsx
// IVM/src/components/ui/dropdown-menu.tsx
"use client";

import { forwardRef } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold text-foreground", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
};
```

---

#### 6.7 -- Stepper

```tsx
// IVM/src/components/ui/stepper.tsx
"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface Step {
  id: string;
  label: string;
  description?: string;
  status: "completed" | "current" | "upcoming";
}

interface StepperProps {
  steps: Step[];
  className?: string;
  onStepClick?: (stepId: string) => void;
}

export function Stepper({ steps, className, onStepClick }: StepperProps) {
  return (
    <nav aria-label="Progress" className={cn("w-full", className)}>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => onStepClick?.(step.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors w-full",
                step.status === "completed" &&
                  "text-status-success",
                step.status === "current" &&
                  "bg-primary/10 text-primary font-medium",
                step.status === "upcoming" &&
                  "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  step.status === "completed" &&
                    "bg-status-success/10 text-status-success",
                  step.status === "current" &&
                    "bg-primary text-primary-foreground",
                  step.status === "upcoming" &&
                    "bg-muted text-muted-foreground"
                )}
              >
                {step.status === "completed" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 min-w-4",
                  step.status === "completed"
                    ? "bg-status-success/40"
                    : "bg-border"
                )}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

---

#### 6.8 -- Empty State

```tsx
// IVM/src/components/ui/empty-state.tsx
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/50 p-12 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-muted p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

---

#### 6.9 -- Textarea

```tsx
// IVM/src/components/ui/textarea.tsx
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
```

---

### Task 7 -- App Shell & Layout

- [ ] **7.1** Root layout
- [ ] **7.2** App shell (sidebar + main area)
- [ ] **7.3** Sidebar
- [ ] **7.4** Header
- [ ] **7.5** Dashboard layout (group)

---

#### 7.1 -- Root Layout

```tsx
// IVM/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IVM - Intelligent Value Mapper",
  description: "AI-powered document-to-form autofill platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
```

---

#### 7.2 -- App Shell

```tsx
// IVM/src/components/layout/app-shell.tsx
import { Sidebar } from "./sidebar";
import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

---

#### 7.3 -- Sidebar

```tsx
// IVM/src/components/layout/sidebar.tsx
import Link from "next/link";
import { LayoutDashboard, Plus, Settings } from "lucide-react";
import { NavItem } from "./nav-item";

export function Sidebar() {
  return (
    <aside className="flex w-[var(--sidebar-width)] flex-col border-r border-sidebar-border bg-sidebar-bg">
      <div className="flex h-14 items-center px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground font-semibold"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            IV
          </div>
          <span>IVM</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        <NavItem href="/" icon={LayoutDashboard} label="Dashboard" />
        <NavItem href="/sessions/new" icon={Plus} label="New Session" />
      </nav>

      <div className="border-t border-sidebar-border px-3 py-2">
        <NavItem href="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  );
}
```

---

#### 7.4 -- Nav Item

```tsx
// IVM/src/components/layout/nav-item.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
}

export function NavItem({ href, icon: Icon, label }: NavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}
```

---

#### 7.5 -- Header

```tsx
// IVM/src/components/layout/header.tsx
import { auth, signOut } from "@/lib/auth";
import { LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export async function Header() {
  const session = await auth();

  return (
    <header className="flex h-14 items-center justify-end border-b border-border bg-card px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full">
            <User className="h-4 w-4" />
            <span className="sr-only">User menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium text-foreground">
                {session?.user?.name ?? "User"}
              </p>
              <p className="text-xs text-muted-foreground">
                {session?.user?.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

---

#### 7.6 -- Dashboard Layout

```tsx
// IVM/src/app/(dashboard)/layout.tsx
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
```

**Verification**: After sign-in, the dashboard layout renders with a sidebar showing "Dashboard" and "New Session" links, a header with a user dropdown, and a main content area.

---

### Task 8 -- Dashboard Page (Session List)

- [ ] **8.1** Dashboard page (server component)
- [ ] **8.2** Session card component
- [ ] **8.3** Session list component

---

#### 8.1 -- Dashboard Page

```tsx
// IVM/src/app/(dashboard)/page.tsx
import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SessionList } from "@/components/sessions/session-list";

export default async function DashboardPage() {
  const session = await requireAuth();

  const sessions = await db.fillSession.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      currentStep: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Manage your document-to-form mapping sessions
          </p>
        </div>
        <Button asChild>
          <Link href="/sessions/new">
            <Plus className="mr-2 h-4 w-4" />
            New Session
          </Link>
        </Button>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No sessions yet"
          description="Create your first session to start mapping documents to forms."
          action={
            <Button asChild>
              <Link href="/sessions/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Session
              </Link>
            </Button>
          }
        />
      ) : (
        <SessionList sessions={sessions} />
      )}
    </div>
  );
}
```

---

#### 8.2 -- Session Card

```tsx
// IVM/src/components/sessions/session-card.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { STEP_LABELS, type SessionStep } from "@/types/session";

interface SessionCardProps {
  session: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    currentStep: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

const STATUS_BADGE_MAP: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "error" | "info" }> = {
  CREATED: { label: "Created", variant: "secondary" },
  SOURCE_UPLOADED: { label: "Source Uploaded", variant: "info" },
  EXTRACTED: { label: "Extracted", variant: "info" },
  TARGET_SET: { label: "Target Set", variant: "info" },
  MAPPED: { label: "Mapped", variant: "warning" },
  FILLED: { label: "Filled", variant: "warning" },
  REVIEWED: { label: "Reviewed", variant: "success" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "error" },
};

export function SessionCard({ session }: SessionCardProps) {
  const statusInfo = STATUS_BADGE_MAP[session.status] ?? { label: session.status, variant: "secondary" as const };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{session.title}</CardTitle>
          {session.description && (
            <CardDescription className="line-clamp-2">
              {session.description}
            </CardDescription>
          )}
        </div>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Step: {STEP_LABELS[session.currentStep as SessionStep]}</span>
          <span>Updated {formatDate(session.updatedAt)}</span>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="ghost" size="sm" asChild className="ml-auto">
          <Link href={`/sessions/${session.id}`}>
            Continue
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
```

---

#### 8.3 -- Session List

```tsx
// IVM/src/components/sessions/session-list.tsx
import { SessionCard } from "./session-card";

interface SessionListProps {
  sessions: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    currentStep: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export function SessionList({ sessions }: SessionListProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
```

**Verification**: Dashboard shows empty state with "No sessions yet" message and a "Create Session" button.

---

### Task 9 -- Create Session Flow

- [ ] **9.1** Create session page
- [ ] **9.2** Create session form component
- [ ] **9.3** Session API routes (POST create, GET list)

---

#### 9.1 -- Create Session Page

```tsx
// IVM/src/app/(dashboard)/sessions/new/page.tsx
import { requireAuth } from "@/lib/auth-helpers";
import { CreateSessionForm } from "@/components/sessions/create-session-form";

export default async function CreateSessionPage() {
  await requireAuth();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">New Session</h1>
        <p className="text-sm text-muted-foreground">
          Create a new document-to-form mapping session
        </p>
      </div>
      <CreateSessionForm />
    </div>
  );
}
```

---

#### 9.2 -- Create Session Form

```tsx
// IVM/src/components/sessions/create-session-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export function CreateSessionForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to create session");
      setLoading(false);
      return;
    }

    const data = await res.json();
    router.push(`/sessions/${data.id}`);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium text-foreground">
              Title <span className="text-status-error">*</span>
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Insurance Claim Form"
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium text-foreground">
              Description
            </label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of what you are filling"
              maxLength={1000}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title.trim()}>
              {loading ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

---

#### 9.3 -- Session API Routes

```ts
// IVM/src/app/api/sessions/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSessionSchema } from "@/lib/validations/session";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const fillSession = await db.fillSession.create({
      data: {
        userId: session.user.id,
        title: parsed.data.title,
        description: parsed.data.description || null,
      },
    });

    await db.auditEvent.create({
      data: {
        fillSessionId: fillSession.id,
        eventType: "SESSION_CREATED",
        actor: "USER",
        payload: { title: fillSession.title },
      },
    });

    logger.info({ sessionId: fillSession.id, userId: session.user.id }, "Session created");

    return NextResponse.json(
      { id: fillSession.id, title: fillSession.title },
      { status: 201 }
    );
  } catch (err) {
    logger.error({ err }, "Failed to create session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await db.fillSession.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        currentStep: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(sessions);
  } catch (err) {
    logger.error({ err }, "Failed to list sessions");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

```ts
// IVM/src/app/api/sessions/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateSessionSchema } from "@/lib/validations/session";
import { logger } from "@/lib/logger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
        extractionResults: { select: { id: true, status: true, documentType: true, completedAt: true } },
        targetAssets: { select: { id: true, targetType: true, url: true, fileName: true, isSupported: true } },
        mappingSets: { select: { id: true, status: true, proposedAt: true } },
        fillActions: { select: { id: true, status: true } },
      },
    });

    if (!fillSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(fillSession);
  } catch (err) {
    logger.error({ err }, "Failed to get session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const updated = await db.fillSession.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await db.fillSession.delete({ where: { id } });

    logger.info({ sessionId: id }, "Session deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete session");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

**Verification**: Create a session via the form. It appears on the dashboard. Clicking "Continue" navigates to `/sessions/<id>`.

---

### Task 10 -- Session Detail & Step Pages

- [ ] **10.1** Session detail page (redirect to current step)
- [ ] **10.2** Session stepper component
- [ ] **10.3** Session step layout
- [ ] **10.4** Source step page (empty state)
- [ ] **10.5** Extract step page (empty state)
- [ ] **10.6** Target step page (empty state)
- [ ] **10.7** Map step page (empty state)
- [ ] **10.8** Fill step page (empty state)
- [ ] **10.9** Review step page (empty state)

---

#### 10.1 -- Session Detail Page

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/page.tsx
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

const STEP_ROUTES: Record<string, string> = {
  SOURCE: "source",
  EXTRACT: "extract",
  TARGET: "target",
  MAP: "map",
  FILL: "fill",
  REVIEW: "review",
};

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    select: { currentStep: true },
  });

  if (!fillSession) {
    notFound();
  }

  const stepRoute = STEP_ROUTES[fillSession.currentStep] ?? "source";
  redirect(`/sessions/${id}/${stepRoute}`);
}
```

---

#### 10.2 -- Session Stepper Component

```tsx
// IVM/src/components/sessions/session-stepper.tsx
"use client";

import { useRouter } from "next/navigation";
import { Stepper, type Step } from "@/components/ui/stepper";
import { SESSION_STEPS, STEP_LABELS, type SessionStep } from "@/types/session";

interface SessionStepperProps {
  sessionId: string;
  currentStep: SessionStep;
  sessionStatus: string;
}

const STEP_ROUTES: Record<SessionStep, string> = {
  SOURCE: "source",
  EXTRACT: "extract",
  TARGET: "target",
  MAP: "map",
  FILL: "fill",
  REVIEW: "review",
};

function getStepStatus(
  step: SessionStep,
  currentStep: SessionStep,
  sessionStatus: string
): "completed" | "current" | "upcoming" {
  const stepIndex = SESSION_STEPS.indexOf(step);
  const currentIndex = SESSION_STEPS.indexOf(currentStep);

  if (sessionStatus === "COMPLETED" || sessionStatus === "REVIEWED") {
    return "completed";
  }

  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

export function SessionStepper({
  sessionId,
  currentStep,
  sessionStatus,
}: SessionStepperProps) {
  const router = useRouter();

  const steps: Step[] = SESSION_STEPS.map((step) => ({
    id: step,
    label: STEP_LABELS[step],
    status: getStepStatus(step, currentStep, sessionStatus),
  }));

  function handleStepClick(stepId: string) {
    const route = STEP_ROUTES[stepId as SessionStep];
    if (route) {
      router.push(`/sessions/${sessionId}/${route}`);
    }
  }

  return (
    <Stepper
      steps={steps}
      onStepClick={handleStepClick}
      className="mb-6"
    />
  );
}
```

---

#### 10.3 -- Session Step Layout

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/layout.tsx
import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SessionStepper } from "@/components/sessions/session-stepper";
import type { SessionStep } from "@/types/session";

export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth();
  const { id } = await params;

  const fillSession = await db.fillSession.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      currentStep: true,
      status: true,
    },
  });

  if (!fillSession) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {fillSession.title}
        </h1>
      </div>
      <SessionStepper
        sessionId={fillSession.id}
        currentStep={fillSession.currentStep as SessionStep}
        sessionStatus={fillSession.status}
      />
      {children}
    </div>
  );
}
```

---

#### 10.4 -- Source Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/source/page.tsx
import { Upload } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function SourceStepPage() {
  return (
    <EmptyState
      icon={Upload}
      title="Upload Source Document"
      description="Upload a document, image, or screenshot to extract fields from. Supported formats: PDF, PNG, JPG, DOCX."
    />
  );
}
```

---

#### 10.5 -- Extract Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/extract/page.tsx
import { ScanSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ExtractStepPage() {
  return (
    <EmptyState
      icon={ScanSearch}
      title="Extraction Not Started"
      description="Upload a source document first. AI will extract and identify fields automatically."
    />
  );
}
```

---

#### 10.6 -- Target Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/target/page.tsx
import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function TargetStepPage() {
  return (
    <EmptyState
      icon={Target}
      title="No Target Selected"
      description="Select where to fill the extracted data: a webpage, interactive PDF, or DOCX template."
    />
  );
}
```

---

#### 10.7 -- Map Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/map/page.tsx
import { GitCompareArrows } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function MapStepPage() {
  return (
    <EmptyState
      icon={GitCompareArrows}
      title="Mapping Not Available"
      description="Complete source extraction and target selection first. AI will propose field mappings with rationale."
    />
  );
}
```

---

#### 10.8 -- Fill Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/fill/page.tsx
import { PenTool } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function FillStepPage() {
  return (
    <EmptyState
      icon={PenTool}
      title="Fill Not Started"
      description="Review and accept field mappings first. The system will fill the target form with your approval."
    />
  );
}
```

---

#### 10.9 -- Review Step Page (Empty State)

```tsx
// IVM/src/app/(dashboard)/sessions/[id]/review/page.tsx
import { CheckCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ReviewStepPage() {
  return (
    <EmptyState
      icon={CheckCircle}
      title="Review Not Available"
      description="Complete the fill step first. Review all applied values and verify accuracy before final submission."
    />
  );
}
```

**Verification**: Navigate to a session. Stepper shows all 6 steps with "Source" as current. Each step tab navigates to its route and shows the appropriate empty state.

---

### Task 11 -- Settings Page (Placeholder)

- [ ] **11.1** Settings page

---

#### 11.1 -- Settings Page

```tsx
// IVM/src/app/(dashboard)/settings/page.tsx
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and application preferences
        </p>
      </div>
      <EmptyState
        icon={Settings}
        title="Settings coming soon"
        description="Account settings, API key configuration, and preferences will be available in a future update."
      />
    </div>
  );
}
```

---

### Task 12 -- Final Verification Checklist

After all files are created, verify the following:

- [ ] **12.1** `docker-compose up -d` starts PostgreSQL and Redis without errors
- [ ] **12.2** `npx prisma migrate dev --name init` creates all tables
- [ ] **12.3** `npx prisma db seed` inserts the dev user
- [ ] **12.4** `npm run dev` starts the Next.js dev server on port 3000
- [ ] **12.5** Navigate to `http://localhost:3000` -- redirects to `/sign-in`
- [ ] **12.6** Sign in with `dev@ivm.local` / `password123` -- redirects to dashboard
- [ ] **12.7** Dashboard shows empty state with "No sessions yet"
- [ ] **12.8** Click "New Session" -- form renders with title and description fields
- [ ] **12.9** Create a session -- redirects to session detail
- [ ] **12.10** Session detail shows stepper with 6 steps, "Source" as current
- [ ] **12.11** Click each step tab -- each shows its empty state message
- [ ] **12.12** Navigate back to dashboard -- session card appears in the list
- [ ] **12.13** User dropdown shows name/email and "Sign out" works
- [ ] **12.14** Sign-up page creates a new user
- [ ] **12.15** `npx tsc --noEmit` passes with no type errors

---

## File Manifest

Complete list of files created in Phase 1 (38 files):

```
IVM/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── README.md
├── tsconfig.json
├── middleware.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── (auth)/
    │   │   ├── sign-in/page.tsx
    │   │   └── sign-up/page.tsx
    │   ├── (dashboard)/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   ├── settings/page.tsx
    │   │   └── sessions/
    │   │       ├── new/page.tsx
    │   │       └── [id]/
    │   │           ├── layout.tsx
    │   │           ├── page.tsx
    │   │           ├── source/page.tsx
    │   │           ├── extract/page.tsx
    │   │           ├── target/page.tsx
    │   │           ├── map/page.tsx
    │   │           ├── fill/page.tsx
    │   │           └── review/page.tsx
    │   └── api/
    │       ├── auth/
    │       │   ├── [...nextauth]/route.ts
    │       │   └── register/route.ts
    │       └── sessions/
    │           ├── route.ts
    │           └── [id]/route.ts
    ├── components/
    │   ├── auth/
    │   │   ├── sign-in-form.tsx
    │   │   └── sign-up-form.tsx
    │   ├── layout/
    │   │   ├── app-shell.tsx
    │   │   ├── header.tsx
    │   │   ├── nav-item.tsx
    │   │   └── sidebar.tsx
    │   ├── sessions/
    │   │   ├── create-session-form.tsx
    │   │   ├── session-card.tsx
    │   │   ├── session-list.tsx
    │   │   └── session-stepper.tsx
    │   └── ui/
    │       ├── badge.tsx
    │       ├── button.tsx
    │       ├── card.tsx
    │       ├── dialog.tsx
    │       ├── dropdown-menu.tsx
    │       ├── empty-state.tsx
    │       ├── input.tsx
    │       ├── stepper.tsx
    │       └── textarea.tsx
    ├── lib/
    │   ├── auth-helpers.ts
    │   ├── auth.ts
    │   ├── db.ts
    │   ├── errors.ts
    │   ├── features.ts
    │   ├── logger.ts
    │   ├── utils.ts
    │   ├── storage/
    │   │   ├── index.ts
    │   │   ├── local.ts
    │   │   └── s3.ts
    │   └── validations/
    │       └── session.ts
    ├── styles/
    │   ├── globals.css
    │   └── tokens.css
    └── types/
        ├── extraction.ts
        ├── fill.ts
        ├── mapping.ts
        ├── next-auth.d.ts
        ├── session.ts
        └── target.ts
```

---

## Implementation Order (Recommended Git Commits)

| Order | Task | Commit message |
|-------|------|---------------|
| 1 | Task 1 (1.1-1.8) | `feat: init project config` |
| 2 | Task 2 (2.1-2.4) | `feat: add prisma schema` |
| 3 | Task 3 (3.1-3.8) | `feat: add core lib modules` |
| 4 | Task 4 (4.1-4.3) | `feat: add design tokens` |
| 5 | Task 5 (5.1-5.6) | `feat: add auth system` |
| 6 | Task 6 (6.1-6.9) | `feat: add ui primitives` |
| 7 | Task 7 (7.1-7.6) | `feat: add app shell layout` |
| 8 | Task 8 (8.1-8.3) | `feat: add dashboard page` |
| 9 | Task 9 (9.1-9.3) | `feat: add session creation` |
| 10 | Task 10 (10.1-10.9) | `feat: add session steps` |
| 11 | Task 11 (11.1) | `feat: add settings page` |
| 12 | Task 12 (verification) | -- no commit, validation only -- |

---

## Architecture Decisions

### Decision 1: `FillSession` vs `Session`

The NextAuth model uses `Session` for auth sessions. To avoid conflict, the product session is named `FillSession` in the database and throughout the codebase. The auth session table is mapped to `auth_sessions` via `@@map`.

### Decision 2: RGB channel values in CSS variables

CSS variables store raw RGB channel values (e.g., `--foreground: 15 23 42`) rather than full `rgb()` calls. This allows opacity modifiers to work with Tailwind: `text-foreground/80` compiles to `rgb(15 23 42 / 0.8)`.

### Decision 3: Tailwind v4 `@theme inline`

Tailwind v4 replaces `tailwind.config.ts` with `@theme inline` inside CSS. All color tokens are mapped inside `globals.css`. No separate config file needed.

### Decision 4: Step as URL segments

Each session step is a separate URL (`/sessions/[id]/source`, `/sessions/[id]/extract`, etc.) rather than query params or client-side tabs. This enables deep linking, browser back/forward, and server-side data loading per step.

### Decision 5: JSON columns for flexible schema

`ExtractionResult.fields`, `TargetAsset.detectedFields`, `MappingSet.mappings`, and `AuditEvent.payload` use JSON columns. This avoids premature normalization of structures that will evolve across phases. The TypeScript types in `src/types/` define the expected shapes.

### Decision 6: Storage abstraction from day one

Even though Phase 1 only uses local filesystem, the `StorageAdapter` interface is defined now. Phase 2 will implement file upload through this interface, and switching to S3 requires only implementing the S3 adapter without changing any calling code.

---

## Phase 2 Interface Points

Phase 1 establishes these contracts that Phase 2 will consume:

- **`FillSession`** model with `status` and `currentStep` fields
- **`SourceAsset`** model ready for file metadata
- **`ExtractionResult`** model with `fields` JSON column expecting `ExtractedField[]`
- **`StorageAdapter`** interface for file upload/download
- **Session API routes** supporting PATCH to update `status` and `currentStep`
- **Source step page** at `/sessions/[id]/source` ready for upload UI
- **Extract step page** at `/sessions/[id]/extract` ready for extraction review UI
