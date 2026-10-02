import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { assertBenefitYear, readBenefitYears, selectBenefitYear } from "./benefit-year";
import { scrapeListPage } from "./scraper";

const listUrl = "https://benefits.inspro.com.sg/gas/insurance-claim-admin";
const current = "1 Oct 2026 to 30 Sep 2027 (Current)";
const previous = "1 Oct 2025 to 30 Sep 2026";
const oldest = "1 Oct 2024 to 30 Sep 2025";
const selectors = {
  tableSelector: "table",
  rowSelector: "tbody tr",
  columns: [{ name: "Claim ID", selector: "td:first-child" }, { name: "Status", selector: "td:nth-child(2)" }],
  detailLinkSelector: ":scope",
};

async function fixture(page: Page) {
  await page.route(`${listUrl}/gas-001`, route => route.fulfill({ contentType: "text/html", body: "Claim detail" }));
  await page.route("**/claims?year=*", async route => {
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({ json: { previous: route.request().url().includes("202510") } });
  });
  await page.route(listUrl, route => route.fulfill({ contentType: "text/html", body: `
    <div><div>Benefit Year:</div><select id="year">
      <option value="202610-202709">${current}</option>
      <option value="202510-202609">${previous}</option>
      <option value="202410-202509">${oldest}</option>
    </select></div>
    <select aria-label="Unrelated"><option>2025</option></select>
    <table><tbody><tr><td colspan="2">No claims found</td></tr></tbody></table>
    <script>
      document.querySelector('#year').addEventListener('change', async event => {
        const response = await fetch('/claims?year=' + event.target.value);
        const data = await response.json();
        document.querySelector('tbody').innerHTML = data.previous
          ? '<tr style="cursor:pointer"><td>GAS-001</td><td>Submitted</td></tr>'
          : '<tr><td colspan="2">No claims found</td></tr>';
        if (data.previous) document.querySelector('tbody tr').onclick = () => { location.href = '${listUrl}/gas-001'; };
      });
    </script>` }));
  await page.goto(listUrl, { waitUntil: "networkidle" });
}

test("reads exact portal years and selects previous-year claims from an empty current year", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    assert.deepEqual(await readBenefitYears(page, listUrl), { years: [current, previous, oldest], selected: current });
    assert.equal(await selectBenefitYear(page, listUrl, previous), previous);
    assert.match(await page.locator("tbody").innerText(), /GAS-001/);
    const rows = await scrapeListPage(page, selectors, {
      expectedListUrl: listUrl,
      assertListState: () => assertBenefitYear(page, listUrl, previous),
      afterListNavigation: async () => { await selectBenefitYear(page, listUrl, previous, true); },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detailUrl, `${listUrl}/gas-001`);
    // Going back reloads the fixture's current-year default; it must be restored.
    await assertBenefitYear(page, listUrl, previous);
    assert.match(await page.locator("tbody").innerText(), /GAS-001/);
  } finally { await browser.close(); }
});

test("rejects a stale year and detects an unexpected filter or tenant change", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    await assert.rejects(selectBenefitYear(page, listUrl, "2020–2021"), /no longer available/);
    await assert.rejects(assertBenefitYear(page, listUrl, previous), /changed benefit year/);
    await page.evaluate(() => history.replaceState(null, "", "/other/insurance-claim-admin"));
    await assert.rejects(readBenefitYears(page, listUrl), /different claim list/);
  } finally { await browser.close(); }
});

test("a later claim page reuses the discovered URL pattern without resetting its year", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    await selectBenefitYear(page, listUrl, previous);
    await page.locator("tbody").evaluate(el => { el.innerHTML = '<tr style="cursor:pointer"><td>GAS-002</td><td>Submitted</td></tr>'; });
    const rows = await scrapeListPage(page, selectors, {
      discoverDetailUrls: false,
      detailUrlTemplate: { prefix: `${listUrl}/`, suffix: "" },
      assertListState: () => assertBenefitYear(page, listUrl, previous),
    });
    assert.equal(rows[0].detailUrl, `${listUrl}/gas-002`);
    await assertBenefitYear(page, listUrl, previous);
  } finally { await browser.close(); }
});

test("scheduled runs record the portal default and unsupported portals retain existing behavior", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    assert.equal(await selectBenefitYear(page, listUrl), current);
    await page.route("https://example.com/claims", route => route.fulfill({ body: "Other portal" }));
    await page.goto("https://example.com/claims");
    assert.equal(await selectBenefitYear(page, page.url()), null);
    await assert.rejects(selectBenefitYear(page, page.url(), previous), /does not expose/);
  } finally { await browser.close(); }
});

test("a failed year-loading request stops scraping instead of reporting an empty year", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await fixture(page);
    await page.route("**/claims?year=*", route => route.fulfill({ status: 500, json: { error: "Unavailable" } }));
    await assert.rejects(selectBenefitYear(page, listUrl, previous), /could not load claims/);
  } finally { await browser.close(); }
});
