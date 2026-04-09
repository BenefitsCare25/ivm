# Portal Tracker Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured event timeline to each TrackedItem so scrape failures are self-diagnosable from the UI — no more SSH + log reading required.

**Architecture:** New `TrackedItemEvent` Prisma model stores typed, timestamped events per item. Workers emit events at each processing stage (auth, page load, scrape, download, AI compare). On failure, a screenshot is captured and stored via StorageAdapter. The UI renders an expandable timeline in the existing tracked-items-table row expansion.

**Tech Stack:** Prisma (migration), BullMQ workers (event emission), Playwright (failure screenshots), React (timeline component), existing StorageAdapter (screenshot storage)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add `TrackedItemEvent` model |
| `src/types/portal.ts` | Modify | Add event type enums and interfaces |
| `src/lib/portal-events.ts` | Create | Event emission helper (single function, writes to DB) |
| `src/workers/portal-worker.ts` | Modify | Emit events during list scrape |
| `src/workers/item-detail-worker.ts` | Modify | Emit events during detail processing + failure screenshots |
| `src/app/api/portals/[id]/scrape/[sessionId]/items/[itemId]/events/route.ts` | Create | GET endpoint for item events |
| `src/components/portals/item-event-timeline.tsx` | Create | Timeline UI component |
| `src/components/portals/tracked-items-table.tsx` | Modify | Add timeline to expanded row |
| `src/app/(dashboard)/portals/[id]/sessions/[sessionId]/page.tsx` | Modify | Fetch events with items |

---

### Task 1: Prisma Schema — Add TrackedItemEvent Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add TrackedItemEvent model to schema**

Add after the `TrackedItem` model (around line 382):

```prisma
model TrackedItemEvent {
  id            String   @id @default(cuid())
  trackedItemId String
  eventType     String
  payload       Json     @default("{}")
  screenshotPath String?
  durationMs    Int?
  createdAt     DateTime @default(now())

  trackedItem TrackedItem @relation(fields: [trackedItemId], references: [id], onDelete: Cascade)

  @@index([trackedItemId, createdAt])
  @@map("tracked_item_events")
}
```

- [ ] **Step 2: Add the relation to TrackedItem**

In the `TrackedItem` model, add below the `comparisonResult` relation:

```prisma
  events           TrackedItemEvent[]
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add-tracked-item-events
```

Expected: Migration creates `tracked_item_events` table with columns id, trackedItemId, eventType, payload, screenshotPath, durationMs, createdAt.

- [ ] **Step 4: Verify Prisma client**

```bash
npx prisma generate
```

Expected: No errors, `TrackedItemEvent` available on `db.trackedItemEvent`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add TrackedItemEvent model"
```

---

### Task 2: Types — Add Event Type Definitions

**Files:**
- Modify: `src/types/portal.ts`

- [ ] **Step 1: Add event type constants and interfaces**

Add at the end of `src/types/portal.ts`, before the closing of the file:

```typescript
// ─── Item Events (observability timeline) ───────────────────────

export const ITEM_EVENT_TYPES = [
  "AUTH_START",
  "AUTH_SUCCESS",
  "AUTH_FAIL",
  "PAGE_LOAD",
  "PAGE_LOAD_FAIL",
  "SELECTOR_MATCH",
  "SELECTOR_FAIL",
  "DETAIL_SCRAPE",
  "DETAIL_SCRAPE_FAIL",
  "DOWNLOAD_START",
  "DOWNLOAD_DONE",
  "DOWNLOAD_FAIL",
  "AI_EXTRACT_START",
  "AI_EXTRACT_DONE",
  "AI_EXTRACT_FAIL",
  "AI_COMPARE_START",
  "AI_COMPARE_DONE",
  "AI_COMPARE_FAIL",
  "ITEM_COMPLETE",
  "ITEM_ERROR",
] as const;
export type ItemEventType = (typeof ITEM_EVENT_TYPES)[number];

export interface ItemEventSummary {
  id: string;
  eventType: ItemEventType;
  payload: Record<string, unknown>;
  screenshotPath: string | null;
  durationMs: number | null;
  createdAt: string;
}

export const EVENT_TYPE_LABELS: Record<ItemEventType, string> = {
  AUTH_START: "Authenticating",
  AUTH_SUCCESS: "Authenticated",
  AUTH_FAIL: "Auth Failed",
  PAGE_LOAD: "Page Loaded",
  PAGE_LOAD_FAIL: "Page Load Failed",
  SELECTOR_MATCH: "Selectors Matched",
  SELECTOR_FAIL: "Selector Failed",
  DETAIL_SCRAPE: "Detail Scraped",
  DETAIL_SCRAPE_FAIL: "Detail Scrape Failed",
  DOWNLOAD_START: "Downloading Files",
  DOWNLOAD_DONE: "Files Downloaded",
  DOWNLOAD_FAIL: "Download Failed",
  AI_EXTRACT_START: "AI Extracting",
  AI_EXTRACT_DONE: "AI Extraction Done",
  AI_EXTRACT_FAIL: "AI Extraction Failed",
  AI_COMPARE_START: "AI Comparing",
  AI_COMPARE_DONE: "AI Comparison Done",
  AI_COMPARE_FAIL: "AI Comparison Failed",
  ITEM_COMPLETE: "Completed",
  ITEM_ERROR: "Error",
};

export const EVENT_SEVERITY: Record<ItemEventType, "info" | "success" | "error"> = {
  AUTH_START: "info",
  AUTH_SUCCESS: "success",
  AUTH_FAIL: "error",
  PAGE_LOAD: "success",
  PAGE_LOAD_FAIL: "error",
  SELECTOR_MATCH: "success",
  SELECTOR_FAIL: "error",
  DETAIL_SCRAPE: "success",
  DETAIL_SCRAPE_FAIL: "error",
  DOWNLOAD_START: "info",
  DOWNLOAD_DONE: "success",
  DOWNLOAD_FAIL: "error",
  AI_EXTRACT_START: "info",
  AI_EXTRACT_DONE: "success",
  AI_EXTRACT_FAIL: "error",
  AI_COMPARE_START: "info",
  AI_COMPARE_DONE: "success",
  AI_COMPARE_FAIL: "error",
  ITEM_COMPLETE: "success",
  ITEM_ERROR: "error",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/portal.ts
git commit -m "feat: add item event types"
```

---

### Task 3: Event Emission Helper

**Files:**
- Create: `src/lib/portal-events.ts`

- [ ] **Step 1: Create the event helper**

```typescript
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ItemEventType } from "@/types/portal";

/**
 * Records a structured event for a tracked item.
 * Fire-and-forget — never throws (errors logged, not propagated).
 * Workers call this at each processing stage for observability.
 */
export async function emitItemEvent(
  trackedItemId: string,
  eventType: ItemEventType,
  payload: Record<string, unknown> = {},
  options?: { screenshotPath?: string; durationMs?: number }
): Promise<void> {
  try {
    await db.trackedItemEvent.create({
      data: {
        trackedItemId,
        eventType,
        payload: JSON.parse(JSON.stringify(payload)),
        screenshotPath: options?.screenshotPath ?? null,
        durationMs: options?.durationMs ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, trackedItemId, eventType }, "[events] Failed to emit event");
  }
}

/**
 * Captures a screenshot on failure and emits an error event.
 * Stores screenshot via StorageAdapter and records path in event.
 */
export async function emitFailureEvent(
  trackedItemId: string,
  eventType: ItemEventType,
  error: unknown,
  screenshot?: Buffer
): Promise<void> {
  let screenshotPath: string | undefined;

  if (screenshot) {
    try {
      const { getStorageAdapter } = await import("@/lib/storage");
      const storage = getStorageAdapter();
      const timestamp = Date.now();
      screenshotPath = `portal-events/${trackedItemId}/${eventType}-${timestamp}.png`;
      await storage.upload(screenshotPath, screenshot, "image/png");
    } catch (uploadErr) {
      logger.warn({ uploadErr, trackedItemId }, "[events] Failed to upload failure screenshot");
    }
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : undefined;

  await emitItemEvent(trackedItemId, eventType, { errorMessage, errorStack }, { screenshotPath });
}

/**
 * Utility: times an async operation and emits start/done/fail events.
 */
export async function withEventTracking<T>(
  trackedItemId: string,
  startType: ItemEventType,
  doneType: ItemEventType,
  failType: ItemEventType,
  startPayload: Record<string, unknown>,
  fn: () => Promise<T>,
  captureScreenshot?: () => Promise<Buffer | undefined>
): Promise<T> {
  await emitItemEvent(trackedItemId, startType, startPayload);
  const t0 = Date.now();

  try {
    const result = await fn();
    await emitItemEvent(trackedItemId, doneType, startPayload, { durationMs: Date.now() - t0 });
    return result;
  } catch (err) {
    const screenshot = captureScreenshot ? await captureScreenshot().catch(() => undefined) : undefined;
    await emitFailureEvent(trackedItemId, failType, err, screenshot);
    throw err;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/portal-events.ts
git commit -m "feat: add portal event emission helper"
```

---

### Task 4: Instrument Portal Worker (List Scrape)

**Files:**
- Modify: `src/workers/portal-worker.ts`

- [ ] **Step 1: Add import**

At the top of `src/workers/portal-worker.ts`, add:

```typescript
import { emitItemEvent } from "@/lib/portal-events";
```

Note: The portal worker operates at the session level (not per-item), so we emit session-level auth events by using a synthetic "session" trackedItemId. Instead, we'll emit auth events on the first TrackedItem created for each session in Task 5. For now, the portal worker gets no event instrumentation — auth events are emitted from the detail worker where we have a real trackedItemId.

Actually — skip modifying this file. Auth events will be captured per-item in the detail worker (Task 5), which is where individual item processing starts. The portal worker only does list discovery and has no per-item context yet.

- [ ] **Step 2: Commit (no-op — skip to Task 5)**

No changes needed for portal-worker.ts.

---

### Task 5: Instrument Item Detail Worker

**Files:**
- Modify: `src/workers/item-detail-worker.ts`

This is the core task — we instrument every stage of the `processItemDetailCore` function.

- [ ] **Step 1: Add imports**

Add at the top of the file:

```typescript
import { emitItemEvent, emitFailureEvent, withEventTracking } from "@/lib/portal-events";
```

- [ ] **Step 2: Instrument auth stage**

In `processItemDetailCore`, after the `PROCESSING` status update (line 38) and before `resolveAuth` (line 59), wrap the auth call:

Replace:

```typescript
    const { context, page } = await resolveAuth({
      credential: portal.credential,
      baseUrl: portal.baseUrl,
      listPageUrl: portal.listPageUrl,
    });
```

With:

```typescript
    await emitItemEvent(trackedItemId, "AUTH_START", {
      method: portal.credential?.cookieData ? "cookies" : "credentials",
      baseUrl: portal.baseUrl,
    });

    let context;
    let page;
    try {
      ({ context, page } = await resolveAuth({
        credential: portal.credential,
        baseUrl: portal.baseUrl,
        listPageUrl: portal.listPageUrl,
      }));
      await emitItemEvent(trackedItemId, "AUTH_SUCCESS", { landingUrl: page.url() });
    } catch (authErr) {
      await emitFailureEvent(trackedItemId, "AUTH_FAIL", authErr);
      throw authErr;
    }
```

- [ ] **Step 3: Instrument detail page scrape**

Replace:

```typescript
      const detailData = await scrapeDetailPage(page, item.detailPageUrl, detailSelectors);
```

With:

```typescript
      const detailData = await withEventTracking(
        trackedItemId,
        "DETAIL_SCRAPE",
        "DETAIL_SCRAPE",
        "DETAIL_SCRAPE_FAIL",
        { url: item.detailPageUrl, selectorCount: Object.keys(detailSelectors.fieldSelectors ?? {}).length },
        () => scrapeDetailPage(page, item.detailPageUrl!, detailSelectors),
        () => page.screenshot({ fullPage: true, type: "png" }).then(b => Buffer.from(b))
      );

      await emitItemEvent(trackedItemId, "SELECTOR_MATCH", {
        fieldCount: Object.keys(detailData).length,
        fields: Object.keys(detailData),
      });
```

- [ ] **Step 4: Instrument file downloads**

Replace:

```typescript
      const downloadedFiles = await downloadFiles(page, detailSelectors, storagePrefix);
```

With:

```typescript
      await emitItemEvent(trackedItemId, "DOWNLOAD_START", { storagePrefix });
      const downloadedFiles = await downloadFiles(page, detailSelectors, storagePrefix);
      await emitItemEvent(trackedItemId, "DOWNLOAD_DONE", {
        fileCount: downloadedFiles.length,
        files: downloadedFiles.map(f => ({ name: f.originalName, size: f.sizeBytes })),
      });
```

- [ ] **Step 5: Instrument AI extraction**

Wrap the file extraction loop. Replace:

```typescript
      for (const file of downloadedFiles) {
        if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) {
          try {
            const { getStorageAdapter } = await import("@/lib/storage");
            const storage = getStorageAdapter();
            const fileBuffer = await storage.download(file.storagePath);

            const extraction = await extractFieldsFromDocument({
              sourceAssetId: trackedItemId,
              mimeType: file.mimeType,
              fileData: fileBuffer,
              fileName: file.originalName,
              provider,
              apiKey,
            });

            for (const field of extraction.fields) {
              pdfFields[field.label] = field.value;
            }
          } catch (err) {
            logger.warn({ err, fileName: file.originalName }, "[worker] Failed to extract from file");
          }
        }
      }
```

With:

```typescript
      for (const file of downloadedFiles) {
        if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) {
          try {
            await emitItemEvent(trackedItemId, "AI_EXTRACT_START", {
              fileName: file.originalName, provider,
            });
            const t0 = Date.now();

            const { getStorageAdapter } = await import("@/lib/storage");
            const storage = getStorageAdapter();
            const fileBuffer = await storage.download(file.storagePath);

            const extraction = await extractFieldsFromDocument({
              sourceAssetId: trackedItemId,
              mimeType: file.mimeType,
              fileData: fileBuffer,
              fileName: file.originalName,
              provider,
              apiKey,
            });

            for (const field of extraction.fields) {
              pdfFields[field.label] = field.value;
            }

            await emitItemEvent(trackedItemId, "AI_EXTRACT_DONE", {
              fileName: file.originalName,
              fieldCount: extraction.fields.length,
            }, { durationMs: Date.now() - t0 });
          } catch (err) {
            logger.warn({ err, fileName: file.originalName }, "[worker] Failed to extract from file");
            await emitFailureEvent(trackedItemId, "AI_EXTRACT_FAIL", err);
          }
        }
      }
```

- [ ] **Step 6: Instrument AI comparison**

Replace:

```typescript
      let comparisonResult;
      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        comparisonResult = await compareFields({
          pageFields: detailData,
          pdfFields,
          provider,
          apiKey,
        });
      }
```

With:

```typescript
      let comparisonResult;
      if (Object.keys(detailData).length > 0 && Object.keys(pdfFields).length > 0) {
        comparisonResult = await withEventTracking(
          trackedItemId,
          "AI_COMPARE_START",
          "AI_COMPARE_DONE",
          "AI_COMPARE_FAIL",
          {
            provider,
            pageFieldCount: Object.keys(detailData).length,
            pdfFieldCount: Object.keys(pdfFields).length,
          },
          () => compareFields({ pageFields: detailData, pdfFields, provider, apiKey })
        );
      }
```

- [ ] **Step 7: Add completion event**

After the final status update (`await db.trackedItem.update({ ... data: { status: hasMismatch ? "FLAGGED" : "COMPARED" } })`), add:

```typescript
      await emitItemEvent(trackedItemId, "ITEM_COMPLETE", {
        status: hasMismatch ? "FLAGGED" : "COMPARED",
        mismatchCount: comparisonResult?.mismatchCount ?? 0,
        fileCount: downloadedFiles.length,
        fieldCount: Object.keys(detailData).length,
      });
```

- [ ] **Step 8: Add error event with screenshot in catch block**

In the outer catch block (around line 156), before the `db.trackedItem.update`, add:

```typescript
    let screenshot: Buffer | undefined;
    try {
      // `page` may not exist if auth failed — guard carefully
      if (typeof page !== "undefined" && page) {
        screenshot = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
      }
    } catch { /* page already closed or crashed */ }

    await emitFailureEvent(trackedItemId, "ITEM_ERROR", err, screenshot);
```

Note: The `page` variable needs to be accessible in the catch block. Move the `let context` and `let page` declarations to before the try block so they're in scope. The refactored auth code from Step 2 already does this.

- [ ] **Step 9: Commit**

```bash
git add src/workers/item-detail-worker.ts
git commit -m "feat: instrument detail worker with events"
```

---

### Task 6: API Route — Fetch Item Events

**Files:**
- Create: `src/app/api/portals/[id]/scrape/[sessionId]/items/[itemId]/events/route.ts`

- [ ] **Step 1: Create the events endpoint**

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, itemId } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    const events = await db.trackedItemEvent.findMany({
      where: { trackedItemId: itemId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        eventType: true,
        payload: true,
        screenshotPath: true,
        durationMs: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portals/[id]/scrape/[sessionId]/items/[itemId]/events/route.ts
git commit -m "feat: add item events API endpoint"
```

---

### Task 7: Screenshot Serving Route

**Files:**
- Create: `src/app/api/portals/[id]/scrape/[sessionId]/items/[itemId]/events/screenshot/route.ts`

Event screenshots need a serving endpoint since they're stored via StorageAdapter.

- [ ] **Step 1: Create screenshot endpoint**

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id, itemId } = await params;
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) throw new ValidationError("Missing path parameter", {});

    // Verify ownership
    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!portal) throw new NotFoundError("Portal");

    // Verify path belongs to this item (prevent path traversal)
    if (!path.startsWith(`portal-events/${itemId}/`)) {
      throw new ValidationError("Invalid screenshot path", {});
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(path);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portals/[id]/scrape/[sessionId]/items/[itemId]/events/screenshot/route.ts
git commit -m "feat: add event screenshot serving route"
```

---

### Task 8: Item Event Timeline Component

**Files:**
- Create: `src/components/portals/item-event-timeline.tsx`

- [ ] **Step 1: Create the timeline component**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Clock, ChevronDown, ChevronRight, Camera, AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ItemEventSummary, ItemEventType } from "@/types/portal";
import { EVENT_TYPE_LABELS, EVENT_SEVERITY } from "@/types/portal";

interface ItemEventTimelineProps {
  portalId: string;
  sessionId: string;
  itemId: string;
  itemStatus: string;
}

const SEVERITY_STYLES: Record<string, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: "text-muted-foreground" },
  success: { icon: CheckCircle2, color: "text-emerald-500" },
  error: { icon: AlertCircle, color: "text-red-500" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function PayloadDetails({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(
    ([k]) => !["errorStack"].includes(k)
  );
  if (entries.length === 0) return null;

  return (
    <div className="mt-1.5 rounded bg-muted px-2.5 py-1.5 text-xs text-muted-foreground space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="font-medium shrink-0">{k}:</span>
          <span className="truncate">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ItemEventTimeline({ portalId, sessionId, itemId, itemStatus }: ItemEventTimelineProps) {
  const [events, setEvents] = useState<ItemEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        const res = await fetch(
          `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEvents(data.events ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();

    // Auto-refresh while item is still processing
    const isActive = itemStatus === "PROCESSING" || itemStatus === "DISCOVERED";
    const interval = isActive
      ? setInterval(fetchEvents, 3000)
      : undefined;

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [portalId, sessionId, itemId, itemStatus]);

  function toggleExpand(eventId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  async function viewScreenshot(path: string) {
    const url = `/api/portals/${portalId}/scrape/${sessionId}/items/${itemId}/events/screenshot?path=${encodeURIComponent(path)}`;
    setScreenshotUrl(url);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Clock className="h-3 w-3 animate-spin" /> Loading timeline...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground">No events recorded.</p>
    );
  }

  return (
    <div className="space-y-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Processing Timeline
      </p>

      <div className="relative pl-4">
        {/* Vertical connector line */}
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />

        {events.map((evt) => {
          const severity = EVENT_SEVERITY[evt.eventType as ItemEventType] ?? "info";
          const style = SEVERITY_STYLES[severity];
          const Icon = style.icon;
          const isExpanded = expanded.has(evt.id);
          const hasPayload = Object.keys(evt.payload).length > 0;

          return (
            <div key={evt.id} className="relative pb-2.5">
              {/* Dot on the line */}
              <div className={`absolute -left-[9.5px] top-[3px] h-2.5 w-2.5 rounded-full border-2 border-background ${
                severity === "error" ? "bg-red-500" : severity === "success" ? "bg-emerald-500" : "bg-muted-foreground"
              }`} />

              <div
                className={`flex items-start gap-2 cursor-pointer ${hasPayload ? "" : "cursor-default"}`}
                onClick={() => hasPayload && toggleExpand(evt.id)}
              >
                <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${style.color}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${severity === "error" ? "text-red-400" : "text-foreground"}`}>
                      {EVENT_TYPE_LABELS[evt.eventType as ItemEventType] ?? evt.eventType}
                    </span>
                    {evt.durationMs != null && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatDuration(evt.durationMs)}
                      </span>
                    )}
                    {evt.screenshotPath && (
                      <button
                        onClick={(e) => { e.stopPropagation(); viewScreenshot(evt.screenshotPath!); }}
                        className="text-[10px] text-accent-foreground/60 hover:text-accent-foreground flex items-center gap-0.5"
                      >
                        <Camera className="h-3 w-3" /> Screenshot
                      </button>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">
                      {formatTime(evt.createdAt)}
                    </span>
                    {hasPayload && (
                      isExpanded
                        ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    )}
                  </div>

                  {isExpanded && <PayloadDetails payload={evt.payload} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Screenshot lightbox */}
      {screenshotUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setScreenshotUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setScreenshotUrl(null)}
              className="absolute top-2 right-2 text-foreground/80 hover:text-foreground bg-background/80 rounded-full p-1"
            >
              &times;
            </button>
            <img
              src={screenshotUrl}
              alt="Failure screenshot"
              className="rounded border border-border"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/portals/item-event-timeline.tsx
git commit -m "feat: add item event timeline component"
```

---

### Task 9: Integrate Timeline into Tracked Items Table

**Files:**
- Modify: `src/components/portals/tracked-items-table.tsx`

- [ ] **Step 1: Add import**

Add at the top:

```typescript
import { ItemEventTimeline } from "./item-event-timeline";
```

- [ ] **Step 2: Add timeline to expanded row content**

Find the expanded row content section in the table — where `DataGridSection` and `ComparisonPanel` are rendered inside the expandable row. After the existing content (after the files section and comparison panel), add the timeline:

```tsx
            {/* Event Timeline */}
            <ItemEventTimeline
              portalId={portalId}
              sessionId={sessionId}
              itemId={item.id}
              itemStatus={item.status}
            />
```

The exact insertion point is inside the expanded `<div>` that renders when a row is clicked (contains `DataGridSection`, file downloads, and `ComparisonPanel`). Place the timeline as the last child of this expanded content div.

- [ ] **Step 3: Commit**

```bash
git add src/components/portals/tracked-items-table.tsx
git commit -m "feat: integrate event timeline into items table"
```

---

### Task 10: Build Verification and Deploy

**Files:**
- None (verification only)

- [ ] **Step 1: Type-check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Successful build.

- [ ] **Step 3: Test migration on dev database**

```bash
docker compose up -d
npx prisma migrate dev
```

Expected: Migration applied, no errors.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `npm run dev`
2. Start detail worker: `npx tsx src/workers/item-detail-worker.ts`
3. Trigger a portal scrape
4. Wait for items to process
5. Expand a tracked item row — verify timeline appears with events
6. If an item has ERROR status — verify screenshot button appears and works

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: build/type fixes for observability"
```

---

## Summary

| Task | What it does | Files touched |
|------|-------------|---------------|
| 1 | Database model for events | `prisma/schema.prisma` |
| 2 | TypeScript types for events | `src/types/portal.ts` |
| 3 | Fire-and-forget event emission helper | `src/lib/portal-events.ts` (new) |
| 4 | (Skipped — portal worker has no per-item context) | — |
| 5 | Instrument every stage of detail worker | `src/workers/item-detail-worker.ts` |
| 6 | API route to fetch events | `src/app/api/.../events/route.ts` (new) |
| 7 | API route to serve screenshots | `src/app/api/.../events/screenshot/route.ts` (new) |
| 8 | Timeline UI component | `src/components/portals/item-event-timeline.tsx` (new) |
| 9 | Wire timeline into existing table | `src/components/portals/tracked-items-table.tsx` |
| 10 | Build verification + smoke test | — |
