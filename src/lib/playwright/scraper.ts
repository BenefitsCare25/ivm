import { Page, Download } from "playwright";
import { logger } from "@/lib/logger";
import { getStorageAdapter } from "@/lib/storage";
import { sanitizeFileName } from "@/lib/utils";
import type { ListSelectors, DetailSelectors } from "@/types/portal";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

export interface ScrapedRow {
  portalItemId: string;
  detailUrl: string | null;
  fields: Record<string, string>;
}

/**
 * Scrapes a list/table page using configured selectors.
 * Returns an array of row objects with field values and detail page links.
 */
export async function scrapeListPage(
  page: Page,
  selectors: ListSelectors
): Promise<ScrapedRow[]> {
  const {
    tableSelector = "table",
    rowSelector = "tbody tr",
    columns = [],
    detailLinkSelector,
  } = selectors;

  await page.waitForSelector(tableSelector, { timeout: 15_000 });

  const rows = await page.$$(
    `${tableSelector} ${rowSelector}`
  );

  logger.info({ rowCount: rows.length }, "[scraper] Found rows on list page");

  const results: ScrapedRow[] = [];

  for (const row of rows) {
    const fields: Record<string, string> = {};

    if (columns.length > 0) {
      for (const col of columns) {
        const cell = await row.$(col.selector);
        fields[col.name] = cell ? (await cell.textContent() ?? "").trim() : "";
      }
    } else {
      // Fallback: extract all td cells by index
      const cells = await row.$$("td");
      for (let i = 0; i < cells.length; i++) {
        const text = (await cells[i].textContent() ?? "").trim();
        fields[`column_${i}`] = text;
      }
    }

    // Extract detail page link
    let detailUrl: string | null = null;
    if (detailLinkSelector) {
      const link = await row.$(detailLinkSelector);
      detailUrl = link ? await link.getAttribute("href") : null;
    } else {
      // Fallback: look for first anchor in the row
      const link = await row.$("a[href]");
      detailUrl = link ? await link.getAttribute("href") : null;
    }

    // Resolve relative URLs
    if (detailUrl && !detailUrl.startsWith("http")) {
      detailUrl = new URL(detailUrl, page.url()).href;
    }

    // Use first non-empty field as portalItemId, or first column
    const portalItemId = Object.values(fields).find((v) => v.length > 0) ?? `row-${results.length}`;

    results.push({ portalItemId, detailUrl, fields });
  }

  return results;
}

/**
 * Scrapes a detail page, extracting all visible field label-value pairs.
 */
export async function scrapeDetailPage(
  page: Page,
  url: string,
  selectors: DetailSelectors
): Promise<Record<string, string>> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  const fields: Record<string, string> = {};

  if (selectors.fieldSelectors && Object.keys(selectors.fieldSelectors).length > 0) {
    for (const [name, selector] of Object.entries(selectors.fieldSelectors)) {
      const el = await page.$(selector);
      fields[name] = el ? (await el.textContent() ?? "").trim() : "";
    }
  } else {
    // Fallback: extract label-value patterns common in detail pages
    // Pattern 1: <th>Label</th><td>Value</td>
    const tableRows = await page.$$("tr");
    for (const row of tableRows) {
      const th = await row.$("th, td:first-child");
      const td = await row.$("td:last-child");
      if (th && td && th !== td) {
        const label = (await th.textContent() ?? "").trim().replace(/:$/, "");
        const value = (await td.textContent() ?? "").trim();
        if (label && value) fields[label] = value;
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
    const labelEls = await page.$$('[class*="label"], [class*="field-name"], [class*="key"]');
    for (const labelEl of labelEls) {
      const valueEl = await labelEl.evaluateHandle((el) => el.nextElementSibling);
      const valNode = valueEl.asElement();
      if (valNode) {
        const label = (await labelEl.textContent() ?? "").trim().replace(/:$/, "");
        const value = (await valNode.textContent() ?? "").trim();
        if (label && value && !fields[label]) fields[label] = value;
      }
    }
  }

  logger.info({ fieldCount: Object.keys(fields).length, url }, "[scraper] Scraped detail page");

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
 * Uses configured selectors or falls back to finding all PDF/document links.
 */
export async function downloadFiles(
  page: Page,
  selectors: DetailSelectors,
  storagePrefix: string
): Promise<DownloadedFile[]> {
  const downloadSelector = selectors.downloadLinkSelector
    ?? 'a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xlsx"], a[href$=".csv"], a[href*="download"]';

  const links = await page.$$(downloadSelector);
  logger.info({ linkCount: links.length }, "[scraper] Found download links");

  const storage = getStorageAdapter();
  const results: DownloadedFile[] = [];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ivm-download-"));

  try {
    for (const link of links) {
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

        results.push({
          fileName: safeName,
          originalName: suggestedName,
          mimeType,
          sizeBytes: stat.size,
          storagePath,
        });

        logger.info({ fileName: safeName, size: stat.size }, "[scraper] File downloaded");
      } catch (err) {
        logger.warn({ err, link: await link.textContent() }, "[scraper] Failed to download file");
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return results;
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
 * Returns true if there's a next page, false otherwise.
 */
export async function goToNextPage(
  page: Page,
  paginationSelector?: string
): Promise<boolean> {
  if (!paginationSelector) return false;

  const nextBtn = await page.$(paginationSelector);
  if (!nextBtn) return false;

  const isDisabled = await nextBtn.getAttribute("disabled");
  if (isDisabled !== null) return false;

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {}),
    nextBtn.click(),
  ]);

  return true;
}
