import type { Page, Request, Response } from "playwright";

export interface PortalBenefitYears {
  years: string[];
  selected: string | null;
}

export function isInsproClaimList(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "benefits.inspro.com.sg" &&
    /^\/[^/]+\/(?:insurance-claim-admin|flex-claim-admin)\/?$/i.test(parsed.pathname);
}

function assertListDestination(page: Page, expectedUrl: string): void {
  const expected = new URL(expectedUrl);
  const actual = new URL(page.url());
  if (actual.origin !== expected.origin || actual.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")) {
    throw new Error("The portal opened a different claim list. Refresh this portal's authentication and try again.");
  }
}

// Read labels from the live select, never calculate policy dates from today's date.
async function inspectBenefitYear(page: Page) {
  return page.locator("select").evaluateAll((selects) => {
    const matches = selects.flatMap((element, index) => {
      const select = element as HTMLSelectElement;
      if (!select.getClientRects().length) return [];
      const labels = Array.from(select.labels ?? []).map(label => label.textContent).join(" ");
      const parent = select.parentElement;
      const nearbyLabel = parent && parent !== document.body && parent.querySelectorAll("select").length === 1
        ? parent.textContent : "";
      const description = `${labels} ${select.getAttribute("aria-label") ?? ""} ${select.name} ${select.id} ${nearbyLabel}`;
      if (!/benefit\s*year|policy\s*year/i.test(description)) return [];
      const options = Array.from(select.options).flatMap((option, optionIndex) => {
        const label = (option.textContent ?? "").replace(/\s+/g, " ").trim();
        return !option.disabled && /\d{4}/.test(label) ? [{ label, index: optionIndex, selected: option.selected }] : [];
      });
      return options.length ? [{ index, options }] : [];
    });
    if (matches.length > 1) throw new Error("Multiple benefit-year selectors were found. Check the portal's claim list configuration.");
    return matches[0] ?? null;
  });
}

export async function readBenefitYears(page: Page, expectedUrl: string): Promise<PortalBenefitYears> {
  // Other portal types retain their existing scrape behavior.
  if (!isInsproClaimList(expectedUrl)) return { years: [], selected: null };
  assertListDestination(page, expectedUrl);
  const deadline = Date.now() + 15_000;
  do {
    const field = await inspectBenefitYear(page);
    if (field) {
      assertListDestination(page, expectedUrl);
      return {
        years: field.options.map(option => option.label),
        selected: field.options.find(option => option.selected)?.label ?? null,
      };
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new Error("Could not read the portal's Benefit Year dropdown. Refresh portal authentication and try again.");
}

export async function selectBenefitYear(page: Page, expectedUrl: string, year?: string | null, reload = false): Promise<string | null> {
  const available = await readBenefitYears(page, expectedUrl);
  if (!available.years.length) {
    if (year) throw new Error("This portal does not expose a supported Benefit Year dropdown.");
    return null;
  }
  const selected = year ?? available.selected;
  if (!selected || !available.years.includes(selected)) {
    throw new Error("The selected benefit year is no longer available in the portal. Reopen Start Scrape Session and choose a year again.");
  }
  if (reload || available.selected !== selected) {
    const field = await inspectBenefitYear(page);
    const option = field?.options.find(option => option.label === selected);
    if (!field || !option) throw new Error("The portal's Benefit Year dropdown changed. Please try again.");
    // An already-idle document can satisfy waitForLoadState immediately, before
    // the change handler's fetch starts. Observe new requests around the action.
    const pending = new Set<Request>();
    let lastActivity = Date.now();
    let requestFailed = false;
    const started = (request: Request) => {
      if (!["fetch", "xhr", "document"].includes(request.resourceType())) return;
      pending.add(request);
      lastActivity = Date.now();
    };
    const finished = (request: Request) => {
      if (pending.delete(request)) lastActivity = Date.now();
    };
    const failed = (request: Request) => {
      if (pending.has(request)) requestFailed = true;
      finished(request);
    };
    const responded = (response: Response) => {
      if (pending.has(response.request()) && response.status() >= 400) requestFailed = true;
    };
    page.on("request", started);
    page.on("response", responded);
    page.on("requestfinished", finished);
    page.on("requestfailed", failed);
    try {
      await page.locator("select").nth(field.index).selectOption({ index: option.index });
      lastActivity = Date.now();
      const deadline = Date.now() + 30_000;
      while (pending.size > 0 || Date.now() - lastActivity < 500) {
        if (Date.now() >= deadline) throw new Error("The portal did not finish loading the selected benefit year. Please try again.");
        await page.waitForTimeout(100);
      }
      if (requestFailed) throw new Error("The portal could not load claims for the selected benefit year. Please try again.");
    } finally {
      page.off("request", started);
      page.off("response", responded);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
    }
  }
  await assertBenefitYear(page, expectedUrl, selected);
  return selected;
}

export async function assertBenefitYear(page: Page, expectedUrl: string, year: string | null): Promise<void> {
  if (!year) return;
  assertListDestination(page, expectedUrl);
  const field = await inspectBenefitYear(page);
  if (field?.options.find(option => option.selected)?.label !== year) {
    throw new Error("The portal changed benefit year during scraping. The session was stopped to avoid mixing policy years. Please try again.");
  }
}
