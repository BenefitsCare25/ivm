import { Page } from "playwright";
import { logger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import {
  normalizeDetailSelectors,
  normalizeListSelectors,
  normalizeOptionalSelector,
  sanitizeFileName,
} from "@/lib/utils";
import type { ColumnSelector, ListSelectors, DetailSelectors } from "@/types/portal";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

export interface ScrapedRow {
  portalItemId: string;
  detailUrl: string | null;
  fields: Record<string, string>;
}

interface ScrapeListPageOptions {
  /** Disable click-based detail URL discovery when only validating selectors. */
  discoverDetailUrls?: boolean;
  /** Intended list URL, retained even if the SPA changes tenants mid-scrape. */
  expectedListUrl?: string;
}

type ListRowSelectorStrategy =
  | "configured-scoped"
  | "configured-page"
  | "table-body-fallback";

interface ListRowSelectorCandidate {
  selector: string;
  strategy: ListRowSelectorStrategy;
}

interface ListRowResolution extends ListRowSelectorCandidate {
  matchingIndexes: number[];
  firstRowText: string;
}

interface ListRowInspection {
  resolution: ListRowResolution | null;
  genericRowCount: number;
  invalidSelectors: string[];
}

class PortalTenantMismatchError extends Error {
  constructor(expectedTenant: string, actualTenant: string) {
    super(
      `Authenticated portal session returned claims for a different tenant (${actualTenant} instead of ${expectedTenant}). Refresh this portal's authentication cookies and try again.`,
    );
    this.name = "PortalTenantMismatchError";
  }
}

function getInsproTenant(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "benefits.inspro.com.sg") return null;
    return parsed.pathname.match(
      /^\/([^/]+)\/(?:insurance-claim-admin|flex-claim-admin)(?:\/|$)/i,
    )?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function assertSamePortalTenant(expectedUrl: string, actualUrl: string): void {
  const expectedTenant = getInsproTenant(expectedUrl);
  const actualTenant = getInsproTenant(actualUrl);
  if (expectedTenant && actualTenant && expectedTenant !== actualTenant) {
    throw new PortalTenantMismatchError(expectedTenant, actualTenant);
  }
}

/**
 * AI-generated selectors are not guaranteed to use the same ancestry path.
 * Try the row selector relative to the configured table, then as an independent
 * page selector, and finally use ordinary table body rows as a safe fallback.
 * Runtime inspection still verifies that every selected row belongs to the
 * configured table, so a broad page selector cannot leak rows from other tables.
 */
export function buildListRowSelectorCandidates(
  tableSelector: string,
  rowSelector: string,
): ListRowSelectorCandidate[] {
  const candidates: ListRowSelectorCandidate[] = [];
  const seen = new Set<string>();

  const add = (selector: string, strategy: ListRowSelectorStrategy) => {
    const normalized = selector.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ selector: normalized, strategy });
  };

  if (rowSelector.startsWith(tableSelector)) {
    add(rowSelector, "configured-scoped");
  } else {
    add(`${tableSelector} ${rowSelector}`, "configured-scoped");
    add(rowSelector, "configured-page");
  }
  add(`${tableSelector} tbody tr`, "table-body-fallback");
  add(
    `${tableSelector} [role='row']:has([role='cell'], [role='gridcell'])`,
    "table-body-fallback",
  );

  return candidates;
}

async function inspectListRows(
  page: Page,
  tableSelector: string,
  candidates: ListRowSelectorCandidate[],
  columnCount: number,
): Promise<ListRowInspection> {
  return page.evaluate(
    ({ targetTableSelector, rowCandidates, configuredColumnCount }) => {
      const table = document.querySelector(targetTableSelector);
      if (!table) {
        return { resolution: null, genericRowCount: 0, invalidSelectors: [] };
      }

      const emptyStatePattern = /^(?:there\s+(?:are|is)\s+)?no\s+(?:records?|results?|data|items?|claims?)(?:\s+(?:available|found|to\s+display))?[.!]*$|^nothing\s+(?:found|to\s+display)[.!]*$/i;
      const loadingPattern = /^(?:loading|please\s+wait)(?:\.{1,3})?$/i;

      const genericRowCount = Array.from(
        table.querySelectorAll("tbody tr, tr, [role='row']"),
      ).filter((row) => {
        const cells = Array.from(
          row.querySelectorAll("td, [role='cell'], [role='gridcell']"),
        );
        const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
        if (
          cells.length === 0 ||
          !text ||
          emptyStatePattern.test(text) ||
          loadingPattern.test(text)
        ) {
          return false;
        }
        if (
          cells.length === 1 &&
          Number(cells[0]?.getAttribute("colspan") ?? "1") > 1
        ) {
          return false;
        }
        return !(configuredColumnCount > 1 && cells.length < 2);
      }).length;

      const invalidSelectors: string[] = [];
      for (const candidate of rowCandidates) {
        try {
          const matches = Array.from(document.querySelectorAll(candidate.selector));
          const matchingIndexes: number[] = [];
          let firstRowText = "";

          for (let index = 0; index < matches.length; index++) {
            const match = matches[index];
            if (match === table || !table.contains(match)) continue;

            const cells = Array.from(
              match.querySelectorAll("td, [role='cell'], [role='gridcell']"),
            );
            const text = (match.textContent ?? "").replace(/\s+/g, " ").trim();
            if (
              cells.length === 0 ||
              !text ||
              emptyStatePattern.test(text) ||
              loadingPattern.test(text)
            ) {
              continue;
            }
            if (
              cells.length === 1 &&
              Number(cells[0]?.getAttribute("colspan") ?? "1") > 1
            ) {
              continue;
            }
            if (
              candidate.strategy === "table-body-fallback" &&
              configuredColumnCount > 1 &&
              cells.length < 2
            ) {
              continue;
            }

            matchingIndexes.push(index);
            if (!firstRowText) firstRowText = match.textContent ?? "";
          }

          if (matchingIndexes.length > 0) {
            return {
              resolution: {
                ...candidate,
                matchingIndexes,
                firstRowText,
              },
              genericRowCount,
              invalidSelectors,
            };
          }
        } catch {
          invalidSelectors.push(candidate.selector);
        }
      }

      return {
        resolution: null,
        genericRowCount,
        invalidSelectors,
      };
    },
    {
      targetTableSelector: tableSelector,
      rowCandidates: candidates,
      configuredColumnCount: columnCount,
    },
  );
}

async function waitForListRows(
  page: Page,
  tableSelector: string,
  candidates: ListRowSelectorCandidate[],
  columnCount: number,
  timeout: number,
): Promise<boolean> {
  return page
    .waitForFunction(
      ({ targetTableSelector, rowCandidates, configuredColumnCount }) => {
        const table = document.querySelector(targetTableSelector);
        if (!table) return false;

        const emptyStatePattern = /^(?:there\s+(?:are|is)\s+)?no\s+(?:records?|results?|data|items?|claims?)(?:\s+(?:available|found|to\s+display))?[.!]*$|^nothing\s+(?:found|to\s+display)[.!]*$/i;
        const loadingPattern = /^(?:loading|please\s+wait)(?:\.{1,3})?$/i;
        const genericRows = Array.from(
          table.querySelectorAll("tbody tr, tr, [role='row']"),
        );
        if (genericRows.some((row) => {
          const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
          return emptyStatePattern.test(text);
        })) {
          return true;
        }

        return rowCandidates.some((candidate) => {
          try {
            return Array.from(document.querySelectorAll(candidate.selector)).some(
              (match) => {
                if (match === table || !table.contains(match)) return false;
                const cells = Array.from(
                  match.querySelectorAll("td, [role='cell'], [role='gridcell']"),
                );
                const text = (match.textContent ?? "").replace(/\s+/g, " ").trim();
                if (
                  cells.length === 0 ||
                  !text ||
                  emptyStatePattern.test(text) ||
                  loadingPattern.test(text)
                ) {
                  return false;
                }
                if (
                  cells.length === 1 &&
                  Number(cells[0]?.getAttribute("colspan") ?? "1") > 1
                ) {
                  return false;
                }
                return !(
                  candidate.strategy === "table-body-fallback" &&
                  configuredColumnCount > 1 &&
                  cells.length < 2
                );
              },
            );
          } catch {
            return false;
          }
        });
      },
      {
        targetTableSelector: tableSelector,
        rowCandidates: candidates,
        configuredColumnCount: columnCount,
      },
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function waitForFirstListRowToChange(
  page: Page,
  tableSelector: string,
  candidate: ListRowSelectorCandidate,
  columnCount: number,
  previousText: string,
  timeout: number,
): Promise<boolean> {
  return page
    .waitForFunction(
      ({ targetTableSelector, rowCandidate, configuredColumnCount, oldText }) => {
        const table = document.querySelector(targetTableSelector);
        if (!table) return false;

        try {
          const emptyStatePattern = /^(?:there\s+(?:are|is)\s+)?no\s+(?:records?|results?|data|items?|claims?)(?:\s+(?:available|found|to\s+display))?[.!]*$|^nothing\s+(?:found|to\s+display)[.!]*$/i;
          const loadingPattern = /^(?:loading|please\s+wait)(?:\.{1,3})?$/i;
          const firstRow = Array.from(document.querySelectorAll(rowCandidate.selector)).find(
            (match) => {
              if (match === table || !table.contains(match)) return false;
              const cells = Array.from(
                match.querySelectorAll("td, [role='cell'], [role='gridcell']"),
              );
              const text = (match.textContent ?? "").replace(/\s+/g, " ").trim();
              if (
                cells.length === 0 ||
                !text ||
                emptyStatePattern.test(text) ||
                loadingPattern.test(text)
              ) {
                return false;
              }
              if (
                cells.length === 1 &&
                Number(cells[0]?.getAttribute("colspan") ?? "1") > 1
              ) {
                return false;
              }
              return !(
                rowCandidate.strategy === "table-body-fallback" &&
                configuredColumnCount > 1 &&
                cells.length < 2
              );
            },
          );
          return firstRow ? (firstRow.textContent ?? "") !== oldText : false;
        } catch {
          return false;
        }
      },
      {
        targetTableSelector: tableSelector,
        rowCandidate: candidate,
        configuredColumnCount: columnCount,
        oldText: previousText,
      },
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * Scrapes a list/table page using configured selectors.
 * Returns an array of row objects with field values and detail page links.
 */
export async function scrapeListPage(
  page: Page,
  selectors: ListSelectors,
  options: ScrapeListPageOptions = {},
): Promise<ScrapedRow[]> {
  const expectedPortalUrl = options.expectedListUrl ?? page.url();
  const normalizedSelectors = normalizeListSelectors(selectors);
  const {
    tableSelector = "table",
    rowSelector = "tbody tr",
    columns = [],
    detailLinkSelector,
  } = normalizedSelectors;

  const rowCandidates = buildListRowSelectorCandidates(tableSelector, rowSelector);

  // Log the current URL to help diagnose auth/redirect issues
  logger.info({ url: page.url(), tableSelector }, "[scraper] Waiting for table selector");

  await page.waitForSelector(tableSelector, { timeout: 30_000 }).catch((err) => {
    const currentUrl = page.url();
    logger.error({ currentUrl, tableSelector }, "[scraper] Table selector not found — page may have redirected to login or selector is wrong");
    throw err;
  });

  // Wait for rows to render (SPA portals load the table shell first, then fetch data).
  // Candidate resolution supports both relative and independent full-page selectors.
  const rowsAppeared = await waitForListRows(
    page,
    tableSelector,
    rowCandidates,
    columns.length,
    15_000,
  );
  if (!rowsAppeared) {
    logger.warn("[scraper] Timed out waiting for table rows to render");
  }

  await page.waitForTimeout(1000);

  // Some multi-tenant SPAs can change the route after the initial navigation
  // has completed. Compare against the originally requested portal, not the
  // mutable live URL, so a late tenant switch cannot be masked by row filters.
  assertSamePortalTenant(expectedPortalUrl, page.url());

  const inspection = await inspectListRows(
    page,
    tableSelector,
    rowCandidates,
    columns.length,
  );
  const resolvedRows = inspection.resolution;

  if (!resolvedRows) {
    if (inspection.genericRowCount > 0) {
      throw new Error(
        `Portal table contains ${inspection.genericRowCount} row(s), but the configured row selector did not match them.`,
      );
    }
    const configuredCandidates = rowCandidates.filter(
      (candidate) => candidate.strategy !== "table-body-fallback",
    );
    if (
      configuredCandidates.length > 0 &&
      configuredCandidates.every((candidate) =>
        inspection.invalidSelectors.includes(candidate.selector),
      )
    ) {
      throw new Error("The configured table row selector is not valid CSS.");
    }

    logger.info(
      { tableSelector, rowSelector },
      "[scraper] Portal table is currently empty",
    );
    return [];
  }

  if (resolvedRows.strategy !== "configured-scoped") {
    logger.warn(
      {
        tableSelector,
        configuredRowSelector: rowSelector,
        resolvedRowSelector: resolvedRows.selector,
        strategy: resolvedRows.strategy,
      },
      "[scraper] Adapted the configured row selector to the live table DOM",
    );
  }

  const allCandidateRows = await page.$$(resolvedRows.selector);
  const rows = resolvedRows.matchingIndexes.flatMap((index) => {
    const row = allCandidateRows[index];
    return row ? [row] : [];
  });

  logger.info(
    { rowCount: rows.length, rowSelectorStrategy: resolvedRows.strategy },
    "[scraper] Found rows on list page",
  );

  // Phase 1: Extract all field data and href-based URLs without navigation
  const results: ScrapedRow[] = [];
  let hasAnyUrl = false;
  let firstClickableRow = false;

  for (const row of rows) {
    const fields: Record<string, string> = {};

    if (columns.length > 0) {
      for (const col of columns) {
        const cell = await row.$(col.selector);
        fields[col.name] = cell ? (await cell.textContent() ?? "").trim() : "";
      }
    } else {
      const cells = await row.$$("td");
      for (let i = 0; i < cells.length; i++) {
        const text = (await cells[i].textContent() ?? "").trim();
        fields[`column_${i}`] = text;
      }
    }

    let detailUrl: string | null = null;
    if (detailLinkSelector) {
      const link = await row.$(detailLinkSelector);
      if (link) {
        detailUrl = await link.getAttribute("href");
        if (!detailUrl) {
          const onclick = await link.getAttribute("onclick");
          if (onclick) {
            const match = onclick.match(/['"]([^'"]*\/[^'"]+)['"]/);
            if (match) detailUrl = match[1];
          }
        }
      }
    } else {
      const link = await row.$("a[href]");
      detailUrl = link ? await link.getAttribute("href") : null;
    }

    if (detailUrl && !detailUrl.startsWith("http")) {
      detailUrl = new URL(detailUrl, page.url()).href;
    }

    if (detailUrl) assertSamePortalTenant(expectedPortalUrl, detailUrl);

    if (detailUrl) hasAnyUrl = true;

    if (!firstClickableRow && !detailUrl) {
      const isClickable = await row.evaluate((el) =>
        window.getComputedStyle(el).cursor === "pointer"
      );
      if (isClickable) firstClickableRow = true;
    }

    const portalItemId = Object.values(fields).find((v) => v.length > 0) ?? `row-${results.length}`;
    results.push({ portalItemId, detailUrl, fields });
  }

  // Phase 2: If no URLs found and rows are clickable, discover URL pattern by clicking first row
  if (
    options.discoverDetailUrls !== false &&
    !hasAnyUrl &&
    firstClickableRow &&
    results.length > 0
  ) {
    logger.info("[scraper] No URLs found, attempting click-discovery on first row");
    try {
      const firstRow = rows[0];
      if (firstRow) {
        const currentUrl = page.url();
        await firstRow.click();
        await page.waitForFunction(
          (origUrl) => window.location.href !== origUrl,
          currentUrl,
          { timeout: 5_000 }
        ).catch(() => {});

        if (page.url() !== currentUrl) {
          const discoveredUrl = page.url();
          assertSamePortalTenant(expectedPortalUrl, discoveredUrl);
          const firstId = results[0].portalItemId;
          const lowerFirstId = firstId.toLowerCase().replace(/\s+/g, "-");

          if (discoveredUrl.toLowerCase().includes(lowerFirstId)) {
            const baseDetailUrl = discoveredUrl.substring(
              0, discoveredUrl.toLowerCase().indexOf(lowerFirstId)
            );
            logger.info({ baseDetailUrl, discoveredUrl, firstId }, "[scraper] Detected detail URL pattern");

            // Apply pattern to all rows
            for (const row of results) {
              const id = row.portalItemId.toLowerCase().replace(/\s+/g, "-");
              row.detailUrl = baseDetailUrl + id;
            }
          } else {
            // URL pattern doesn't match ID — just assign first row's URL
            results[0].detailUrl = discoveredUrl;
            logger.warn({ discoveredUrl, firstId }, "[scraper] URL doesn't contain row ID, cannot extrapolate");
          }

          // Navigate back to list page for pagination support
          await page.goBack({ timeout: 15_000 });
          await waitForListRows(
            page,
            tableSelector,
            rowCandidates,
            columns.length,
            15_000,
          );
          await page.waitForTimeout(1000);
        }
      }
    } catch (error) {
      if (error instanceof PortalTenantMismatchError) throw error;
      logger.warn("[scraper] Click-discovery failed");
    }
  }

  return results;
}

// CSS selectors for the structures the fallback extractor reads. Shared between
// the content-settle wait and the extractor so the "wait for it" and "read it"
// steps can never target different things.
const FALLBACK_LABEL_SELECTOR = '[class*="label"], [class*="field-name"], [class*="key"]';

/**
 * Extract label→value pairs from an already-rendered detail page. Prefers the
 * portal's configured fieldSelectors; otherwise falls back to the label/value
 * structures common in admin panels (table rows, definition lists, label divs).
 */
async function extractDetailFields(
  page: Page,
  selectors: DetailSelectors
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};

  if (selectors.fieldSelectors && Object.keys(selectors.fieldSelectors).length > 0) {
    for (const [name, selector] of Object.entries(selectors.fieldSelectors)) {
      const el = await page.$(selector);
      fields[name] = el ? (await el.textContent() ?? "").trim() : "";
    }
    return fields;
  }

  // Fallback: extract label-value patterns common in detail pages
  // Pattern 1: <th>Label</th><td>Value</td>
  const tableRows = await page.$$("tr");
  for (const row of tableRows) {
    const th = await row.$("th, td:first-child");
    const td = await row.$("td:last-child");
    if (th && td) {
      const isSame = await th.evaluate((el, other) => el === other, td);
      if (!isSame) {
        const label = (await th.textContent() ?? "").trim().replace(/:$/, "");
        const value = (await td.textContent() ?? "").trim();
        if (label && value) fields[label] = value;
      }
    }
  }

  // Pattern 2: <dt>Label</dt><dd>Value</dd>
  const dts = await page.$$("dt");
  for (const dt of dts) {
    const dd = await dt.evaluateHandle((el) => el.nextElementSibling);
    const ddEl = dd.asElement();
    if (ddEl) {
      const label = (await dt.textContent() ?? "").trim().replace(/:$/, "");
      const value = (await ddEl.textContent() ?? "").trim();
      if (label && value) fields[label] = value;
    }
  }

  // Pattern 3: <div class="label">Label</div><div class="value">Value</div>
  // (common in custom admin panels — label followed by sibling value)
  const labelEls = await page.$$(FALLBACK_LABEL_SELECTOR);
  for (const labelEl of labelEls) {
    const valueEl = await labelEl.evaluateHandle((el) => el.nextElementSibling);
    const valNode = valueEl.asElement();
    if (valNode) {
      const label = (await labelEl.textContent() ?? "").trim().replace(/:$/, "");
      const value = (await valNode.textContent() ?? "").trim();
      if (label && value && !fields[label]) fields[label] = value;
    }
  }

  return fields;
}

// Detail-page settle budget: keep re-extracting until the page yields a real
// result or this elapses. A rendered claim detail has many fields; MIN_ ... is
// the floor that separates "real content" from a still-loading shell.
const DETAIL_SETTLE_TIMEOUT_MS = 15_000;
const DETAIL_POLL_INTERVAL_MS = 1_000;
const MIN_DETAIL_FIELDS = 2;

/** Count fields that actually have a non-empty value (not just a present key). */
function countPopulatedFields(fields: Record<string, string>): number {
  let n = 0;
  for (const v of Object.values(fields)) {
    if (v && v.trim()) n++;
  }
  return n;
}

async function waitForConfiguredDetailRoot(
  page: Page,
  readySelector: string | undefined,
): Promise<void> {
  if (!readySelector) return;

  try {
    await page.waitForSelector(readySelector, {
      state: "attached",
      timeout: DETAIL_SETTLE_TIMEOUT_MS,
    });
  } catch (cause) {
    throw new Error(
      "Claim detail page did not load correctly: the configured ready element was not found.",
      { cause },
    );
  }
}

/**
 * Scrapes a detail page, extracting all visible field label-value pairs.
 */
export async function scrapeDetailPage(
  page: Page,
  url: string,
  selectors: DetailSelectors
): Promise<Record<string, string>> {
  const normalizedSelectors = normalizeDetailSelectors(selectors);
  // Use "domcontentloaded" (not "networkidle"): SPA/long-polling portal pages
  // never reach network idle, and a client-side redirect during load makes
  // goto abort with net::ERR_ABORTED. The poll-extract loop below handles async
  // SPA rendering, so networkidle added only fragility.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForConfiguredDetailRoot(page, normalizedSelectors.readySelector);

  // Poll-extract until the page yields a real result (>= MIN_DETAIL_FIELDS
  // populated values) or the settle budget is exhausted. Keying on the ACTUAL
  // extracted content — not a proxy structure signal — avoids the SPA race where
  // the persistent nav shell (or an empty table/label shell) is present before
  // the claim detail renders: a shell yields 0–1 populated fields, so we keep
  // polling until the real fields load instead of capturing an empty/partial
  // result and falling back to list data (losing Claimant/Provider). Best-effort:
  // whatever the last attempt produced is still returned once the budget is up.
  const deadline = Date.now() + DETAIL_SETTLE_TIMEOUT_MS;
  let fields: Record<string, string> = {};
  for (;;) {
    fields = await extractDetailFields(page, normalizedSelectors);
    if (countPopulatedFields(fields) >= MIN_DETAIL_FIELDS) break;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(DETAIL_POLL_INTERVAL_MS);
  }

  const cleaned = filterGarbageFields(fields);
  const populated = countPopulatedFields(cleaned);
  const minimumExpected = normalizedSelectors.readySelector ? 1 : MIN_DETAIL_FIELDS;
  if (populated < minimumExpected) {
    throw new Error(
      `Claim detail page did not load correctly: found ${populated} populated claim fields.`,
    );
  }

  logger.info(
    { fieldCount: Object.keys(cleaned).length, rawFieldCount: Object.keys(fields).length, populated, url },
    "[scraper] Scraped detail page"
  );

  return cleaned;
}

/**
 * Detects and filters out garbage data patterns from fallback extraction.
 * When the page renders non-claim sections (e.g. access management panels),
 * the scraper picks up hundreds of repetitive entries like "CompanyX: Manage Access".
 */
function filterGarbageFields(fields: Record<string, string>): Record<string, string> {
  const entries = Object.entries(fields);
  if (entries.length <= 5) return fields;

  const valueCounts: Record<string, number> = {};
  for (const [, v] of entries) {
    valueCounts[v] = (valueCounts[v] ?? 0) + 1;
  }

  const mostCommonCount = Math.max(...Object.values(valueCounts));
  const mostCommonRatio = mostCommonCount / entries.length;

  // If >50% of values are identical, those entries are noise — remove them
  if (mostCommonRatio > 0.5 && mostCommonCount > 5) {
    const noiseValue = Object.entries(valueCounts).find(([, c]) => c === mostCommonCount)![0];
    const cleaned: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (v !== noiseValue) cleaned[k] = v;
    }
    logger.warn(
      { removedCount: mostCommonCount, noiseValue, remaining: Object.keys(cleaned).length },
      "[scraper] Filtered garbage fields from detail page"
    );
    return cleaned;
  }

  return fields;
}

export interface DownloadedFile {
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

/**
 * Downloads files linked on the current page.
 * Uses direct HTTP fetch (inherits session cookies) for href-based links so inline
 * PDFs and new-tab links are captured reliably. Falls back to click+download event
 * only for javascript: / onclick links that have no navigable href.
 */
export async function downloadFiles(
  page: Page,
  selectors: DetailSelectors,
  storagePrefix: string
): Promise<DownloadedFile[]> {
  const defaultDownloadSelector = 'a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xlsx"], a[href$=".csv"], a[href$=".jpg"], a[href$=".jpeg"], a[href$=".png"], a[href$=".gif"], a[href*="download"]';
  const configuredDownloadSelector = normalizeDetailSelectors(selectors).downloadLinkSelector;
  let downloadSelector = configuredDownloadSelector ?? defaultDownloadSelector;

  // Detail pages load via "domcontentloaded" (not networkidle), so attachment
  // links injected by the SPA's async XHRs may not exist yet when we get here.
  // Wait briefly for the first matching link before reading — resolves fast when
  // documents exist; only hits the timeout on genuinely doc-less pages.
  await page
    .waitForSelector(downloadSelector, { state: "attached", timeout: 8_000 })
    .catch(() => {});

  let links;
  try {
    links = await page.$$(downloadSelector);
  } catch (err) {
    if (!configuredDownloadSelector) throw err;
    logger.warn(
      { err, selector: configuredDownloadSelector },
      "[scraper] Invalid configured download selector; using default",
    );
    downloadSelector = defaultDownloadSelector;
    links = await page.$$(downloadSelector);
  }
  logger.info({ linkCount: links.length, selector: downloadSelector }, "[scraper] Found download links");

  if (links.length === 0) return [];

  const storage = getStorageAdapter();
  const pageUrl = page.url();

  // Collect all hrefs first (fast sequential attribute reads)
  const linkEntries: Array<{ href: string | null; el: (typeof links)[number] }> = [];
  for (const el of links) {
    linkEntries.push({ href: await el.getAttribute("href"), el });
  }

  // Separate into direct-fetch (href) and click-based (javascript:) groups
  const seenUrls = new Set<string>();
  const directUrls: string[] = [];
  const clickLinks: (typeof links) = [];

  for (const { href, el } of linkEntries) {
    if (href && !href.startsWith("javascript:")) {
      const abs = href.startsWith("http") ? href : new URL(href, pageUrl).href;
      if (!seenUrls.has(abs)) {
        seenUrls.add(abs);
        directUrls.push(abs);
      }
    } else {
      clickLinks.push(el);
    }
  }

  // Fetch all direct URLs in parallel
  const directResults = await Promise.allSettled(
    directUrls.map(async (absoluteUrl): Promise<DownloadedFile> => {
      const response = await page.request.get(absoluteUrl, { timeout: 30_000 });
      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }

      const contentType = response.headers()["content-type"] ?? "";
      const contentDisposition = response.headers()["content-disposition"] ?? "";

      let suggestedName =
        extractFilenameFromDisposition(contentDisposition) ??
        path.basename(new URL(absoluteUrl).pathname) ??
        "download";

      if (!path.extname(suggestedName)) {
        if (contentType.includes("pdf")) suggestedName += ".pdf";
        else if (contentType.includes("msword") || contentType.includes("wordprocessingml")) suggestedName += ".docx";
        else if (contentType.includes("spreadsheetml")) suggestedName += ".xlsx";
        else if (contentType.includes("image/jpeg")) suggestedName += ".jpg";
        else if (contentType.includes("image/png")) suggestedName += ".png";
        else if (contentType.includes("image/gif")) suggestedName += ".gif";
        else if (contentType.includes("image/webp")) suggestedName += ".webp";
      }

      const fileBuffer = await response.body();
      const safeName = sanitizeFileName(suggestedName);
      const mimeType = guessMimeType(suggestedName) || contentType.split(";")[0].trim();
      const storagePath = `${storagePrefix}/${safeName}`;

      await storage.upload(storagePath, fileBuffer, mimeType);
      logger.info({ fileName: safeName, size: fileBuffer.length }, "[scraper] File downloaded via direct fetch");

      return { fileName: safeName, originalName: suggestedName, mimeType, sizeBytes: fileBuffer.length, storagePath };
    })
  );

  const results: DownloadedFile[] = [];
  for (const r of directResults) {
    if (r.status === "fulfilled") results.push(r.value);
    else logger.warn({ err: r.reason }, "[scraper] Direct fetch failed");
  }

  // Click-based fallback only when needed (javascript: / onclick links) — must be sequential
  if (clickLinks.length > 0) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ivm-download-"));
    try {
      for (const link of clickLinks) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 15_000 }),
            link.click(),
          ]);

          const suggestedName = download.suggestedFilename();
          const tmpPath = path.join(tmpDir, suggestedName);
          await download.saveAs(tmpPath);

          const stat = await fs.stat(tmpPath);
          const fileBuffer = await fs.readFile(tmpPath);
          const safeName = sanitizeFileName(suggestedName);
          const mimeType = guessMimeType(suggestedName);
          const storagePath = `${storagePrefix}/${safeName}`;

          await storage.upload(storagePath, fileBuffer, mimeType);
          logger.info({ fileName: safeName, size: stat.size }, "[scraper] File downloaded via click event");

          results.push({ fileName: safeName, originalName: suggestedName, mimeType, sizeBytes: stat.size, storagePath });
        } catch (err) {
          logger.warn({ err, linkText: await link.textContent().catch(() => "?") }, "[scraper] Click download failed");
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  return results;
}

function extractFilenameFromDisposition(disposition: string): string | null {
  // Handles both `filename="foo.pdf"` and `filename*=UTF-8''foo.pdf`
  const match = disposition.match(/filename[^;=\n]*=(?:UTF-8'')?(?:['"]?)([^'"\n;]*)(?:['"]?)/i);
  const name = match?.[1]?.trim();
  return name || null;
}

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

/**
 * Handles pagination if a pagination selector is configured.
 * Supports both full-navigation portals and SPA portals (client-side table updates).
 * Returns true if navigated to a new page with different content, false if no more pages.
 */
export async function goToNextPage(
  page: Page,
  paginationSelector?: string,
  tableSelector = "table",
  rowSelector = "tbody tr",
  columns: ColumnSelector[] = [],
): Promise<boolean> {
  const normalizedPaginationSelector = normalizeOptionalSelector(paginationSelector);
  if (!normalizedPaginationSelector) return false;
  const normalizedTableSelector = normalizeOptionalSelector(tableSelector) ?? "table";
  const normalizedRowSelector = normalizeOptionalSelector(rowSelector) ?? "tbody tr";
  const rowCandidates = buildListRowSelectorCandidates(
    normalizedTableSelector,
    normalizedRowSelector,
  );

  const nextBtn = await page.$(normalizedPaginationSelector);
  if (!nextBtn) return false;

  // Check disabled via HTML attribute OR common SPA patterns (class, aria-disabled)
  const isDisabled = await nextBtn.evaluate((el) => {
    if (el.hasAttribute("disabled")) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (el.classList.contains("disabled")) return true;
    return false;
  });
  if (isDisabled) return false;

  // Capture first row text to detect if the table actually changed (SPA pagination)
  const resolvedBeforeClick = (
    await inspectListRows(
      page,
      normalizedTableSelector,
      rowCandidates,
      columns.length,
    )
  ).resolution;
  if (!resolvedBeforeClick) return false;
  const firstRowText = resolvedBeforeClick.firstRowText;

  // Click the button
  await nextBtn.click();

  // Try full-navigation first (works for non-SPA portals)
  const navigated = await page
    .waitForNavigation({ waitUntil: "networkidle", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (navigated) return true;

  // SPA portal: wait for table content to change
  const changed = await waitForFirstListRowToChange(
    page,
    normalizedTableSelector,
    {
      selector: resolvedBeforeClick.selector,
      strategy: resolvedBeforeClick.strategy,
    },
    columns.length,
    firstRowText,
    8_000,
  );

  if (!changed) {
    // Content didn't change — we're on the last page or button did nothing
    logger.info("[scraper] Pagination click did not change table content — no more pages");
    return false;
  }

  // Small settle wait for SPA render to stabilise
  await page.waitForTimeout(500);
  return true;
}
