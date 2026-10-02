import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { PortalDetailDestinationMismatchError, scrapeDetailPage } from "@/lib/playwright/scraper";
import { getDetailAuthExpiryMessage } from "./item-detail-auth";

const origin = "https://benefits.inspro.com.sg";
const listUrl = `${origin}/stm/insurance-claim-admin`;
const detailUrl = `${listUrl}/stm-021664`;
const authenticatedHtml = "<div id='claim-id'>STM-021664</div><div id='provider'>Test provider</div>";

async function captureDetailError(page: Page): Promise<Error> {
  try {
    await scrapeDetailPage(page, detailUrl, {
      fieldSelectors: { "Claim ID": "#claim-id", Provider: "#provider" },
    });
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail("Expected the redirected claim destination to be rejected");
}

for (const destination of ["/admin/logout", "/admin/login"]) {
  test(`classifies an Inspro detail redirect to ${destination} as auth expiry`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const requests: string[] = [];
      await page.route(`${origin}/**`, async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        requests.push(pathname);
        if (pathname === new URL(detailUrl).pathname) {
          await route.fulfill({ status: 302, headers: { location: destination } });
        } else {
          await route.fulfill({ contentType: "text/html", body: destination.endsWith("logout")
            ? "<p>You have logged out successfully</p>" : "<input type='password'>" });
        }
      });
      const error = await captureDetailError(page);
      assert.ok(error instanceof PortalDetailDestinationMismatchError);
      const message = await getDetailAuthExpiryMessage(error, page, listUrl);
      assert.match(message ?? "", /^Portal session expired/);
      assert.equal(requests.includes(new URL(listUrl).pathname), false, "Visible login/logout needs no extra navigation");
    } finally {
      await browser.close();
    }
  });
}

test("probes the portal when a destination mismatch leaves a stale claim visible", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === new URL(detailUrl).pathname) {
        await route.fulfill({ status: 302, headers: { location: `${listUrl}/stm-021537` } });
      } else if (pathname === new URL(listUrl).pathname) {
        await route.fulfill({ status: 302, headers: { location: "/admin/logout" } });
      } else {
        await route.fulfill({ contentType: "text/html", body: authenticatedHtml });
      }
    });
    const error = await captureDetailError(page);
    assert.match(await getDetailAuthExpiryMessage(error, page, listUrl) ?? "", /^Portal session expired/);
    assert.equal(page.url(), `${origin}/admin/logout`);
  } finally {
    await browser.close();
  }
});

test("keeps a wrong claim destination as a mismatch when portal auth is still valid", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/**`, async (route) => {
      if (route.request().url() === detailUrl) {
        await route.fulfill({ status: 302, headers: { location: `${listUrl}/stm-021537` } });
      } else {
        await route.fulfill({ contentType: "text/html", body: authenticatedHtml });
      }
    });
    const error = await captureDetailError(page);
    assert.equal(await getDetailAuthExpiryMessage(error, page, listUrl), null);
    assert.match(error.message, /did not reach the requested claim page/);
  } finally {
    await browser.close();
  }
});

test("does not probe a tenant mismatch, AI failure, or a closed page", async () => {
  const page = { isClosed: () => false, url: () => { throw new Error("Unexpected auth probe"); } } as unknown as Page;
  for (const error of [new Error("Authenticated portal session returned claims for a different tenant"), new Error("AI request failed")]) {
    assert.equal(await getDetailAuthExpiryMessage(error, page, listUrl), null);
  }
  const closedPage = { isClosed: () => true } as Page;
  assert.equal(await getDetailAuthExpiryMessage(new PortalDetailDestinationMismatchError(detailUrl, `${origin}/admin/logout`), closedPage, listUrl), null);
});

test("retains the original error when the auth re-probe fails", async () => {
  const error = new Error("page.goto: net::ERR_ABORTED");
  const page = {
    isClosed: () => false, url: () => detailUrl,
    $: async () => null, textContent: async () => "Claim data",
    goto: async () => { throw new Error("Network unavailable"); },
  } as unknown as Page;
  assert.equal(await getDetailAuthExpiryMessage(error, page, listUrl), null);
  assert.equal(error.message, "page.goto: net::ERR_ABORTED");
});
