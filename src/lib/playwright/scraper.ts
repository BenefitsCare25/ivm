import { Page } from "playwright";
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

  // Log the current URL to help diagnose auth/redirect issues
  logger.info({ url: page.url(), tableSelector }, "[scraper] Waiting for table selector");

  await page.waitForSelector(tableSelector, { timeout: 30_000 }).catch((err) => {
    const currentUrl = page.url();
    logger.error({ currentUrl, tableSelector }, "[scraper] Table selector not found — page may have redirected to login or selector is wrong");
    throw err;
  });

  // Wait for rows to render (SPA portals load the table shell first, then fetch data)
  await page.waitForFunction(
    ([tSel, rSel]) => {
      const rows = document.querySelectorAll(`${tSel} ${rSel}`);
      return rows.length > 0;
    },
    [tableSelector, rowSelector] as const,
    { timeout: 15_000 }
  ).catch(() => {
    logger.warn("[scraper] Timed out waiting for table rows to render");
  });

  await page.waitForTimeout(1000);

  const rows = await page.$$(
    `${tableSelector} ${rowSelector}`
  );

  logger.info({ rowCount: rows.length }, "[scraper] Found rows on list page");

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
  if (!hasAnyUrl && firstClickableRow && results.length > 0) {
    logger.info("[scraper] No URLs found, attempting click-discovery on first row");
    try {
      const firstRow = (await page.$$(`${tableSelector} ${rowSelector}`))[0];
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
          await page.waitForFunction(
            ([tSel, rSel]) => document.querySelectorAll(`${tSel} ${rSel}`).length > 0,
            [tableSelector, rowSelector] as const,
            { timeout: 15_000 }
          ).catch(() => {});
          await page.waitForTimeout(1000);
        }
      }
    } catch {
      logger.warn("[scraper] Click-discovery failed");
    }
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
 * Uses direct HTTP fetch (inherits session cookies) for href-based links so inline
 * PDFs and new-tab links are captured reliably. Falls back to click+download event
 * only for javascript: / onclick links that have no navigable href.
 */
export async function downloadFiles(
  page: Page,
  selectors: DetailSelectors,
  storagePrefix: string
): Promise<DownloadedFile[]> {
  const downloadSelector = selectors.downloadLinkSelector
    ?? 'a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xlsx"], a[href$=".csv"], a[href*="download"]';

  const links = await page.$$(downloadSelector);
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
