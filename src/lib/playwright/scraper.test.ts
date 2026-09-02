import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { goToNextPage, scrapeListPage } from "./scraper";

test("scrapes rows when AI returns independent full-page table and row selectors", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main id="client-admin-employee-list-page">
        <section class="employee-list">
          <div class="bg-white">
            <table class="table">
              <tbody>
                <tr
                  class="no-user-select"
                  style="cursor: pointer"
                  onclick="location.hash = 'neutradc-001641'"
                >
                  <td>NEUTRADC-001641</td>
                  <td>Group Outpatient Specialist</td>
                  <td>Submitted</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    `);

    const rows = await scrapeListPage(page, {
      tableSelector:
        "#client-admin-employee-list-page .employee-list .bg-white > table.table",
      rowSelector:
        "#client-admin-employee-list-page .employee-list table.table > tbody > tr.no-user-select",
      columns: [
        { name: "Claim ID", selector: "td:nth-child(1)" },
        { name: "Claim Type", selector: "td:nth-child(2)" },
        { name: "Status", selector: "td:nth-child(3)" },
      ],
      detailLinkSelector: ":scope",
    });

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.fields, {
      "Claim ID": "NEUTRADC-001641",
      "Claim Type": "Group Outpatient Specialist",
      Status: "Submitted",
    });
    assert.equal(rows[0]?.detailUrl, "about:blank#neutradc-001641");
  } finally {
    await browser.close();
  }
});

test("continues to scrape ordinary table-relative row selectors", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="claims">
        <tbody>
          <tr><td>CLAIM-001</td><td>Submitted</td></tr>
          <tr><td>CLAIM-002</td><td>Submitted</td></tr>
        </tbody>
      </table>
    `);

    const rows = await scrapeListPage(page, {
      tableSelector: "#claims",
      rowSelector: "tbody > tr",
      columns: [
        { name: "Claim ID", selector: "td:nth-child(1)" },
        { name: "Status", selector: "td:nth-child(2)" },
      ],
    });

    assert.deepEqual(
      rows.map((row) => row.portalItemId),
      ["CLAIM-001", "CLAIM-002"],
    );
  } finally {
    await browser.close();
  }
});

test("falls back to rows inside the selected table when the AI row selector is stale", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="unrelated"><tbody><tr><td>IGNORE-ME</td></tr></tbody></table>
      <table id="claims">
        <tbody><tr class="new-portal-row"><td>CLAIM-003</td><td>Submitted</td></tr></tbody>
      </table>
    `);

    const rows = await scrapeListPage(page, {
      tableSelector: "#claims",
      rowSelector: "tbody > tr.old-portal-row",
      columns: [
        { name: "Claim ID", selector: "td:nth-child(1)" },
        { name: "Status", selector: "td:nth-child(2)" },
      ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.portalItemId, "CLAIM-003");
  } finally {
    await browser.close();
  }
});

test("does not turn an empty-state placeholder into a claim", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="claims">
        <tbody><tr><td colspan="9">No claims found</td></tr></tbody>
      </table>
    `);

    const rows = await scrapeListPage(page, {
      tableSelector: "#claims",
      rowSelector: "tbody > tr.claim-row",
      columns: [
        { name: "Claim ID", selector: "td:nth-child(1)" },
        { name: "Status", selector: "td:nth-child(7)" },
      ],
    });

    assert.deepEqual(rows, []);
  } finally {
    await browser.close();
  }
});

test("pagination ignores fallback rows while the resolved data row is loading", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="claims">
        <tbody>
          <tr class="summary"><td colspan="2">Summary</td></tr>
          <tr class="claim-row"><td>CLAIM-004</td><td>Submitted</td></tr>
        </tbody>
      </table>
      <button id="next" onclick="document.querySelector('.claim-row').remove()">Next</button>
    `);

    const changed = await goToNextPage(
      page,
      "#next",
      "#claims",
      "tbody > tr.claim-row",
    );

    assert.equal(changed, false);
  } finally {
    await browser.close();
  }
});

test("rejects an Inspro detail redirect into a different tenant", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.route("https://benefits.inspro.com.sg/neutradc/insurance-claim-admin", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
          <table id="claims">
            <tbody>
              <tr
                class="claim-row"
                style="cursor: pointer"
                onclick="history.pushState({}, '', '/synesysgroup/insurance-claim-admin/synesysgroup-000282')"
              >
                <td>SYNESYSGROUP-000282</td><td>Submitted</td>
              </tr>
            </tbody>
          </table>
        `,
      }),
    );
    await page.goto("https://benefits.inspro.com.sg/neutradc/insurance-claim-admin");

    await assert.rejects(
      scrapeListPage(page, {
        tableSelector: "#claims",
        rowSelector: "tbody > tr.claim-row",
        columns: [
          { name: "Claim ID", selector: "td:nth-child(1)" },
          { name: "Status", selector: "td:nth-child(2)" },
        ],
        detailLinkSelector: ":scope",
      }),
      /different tenant/i,
    );
  } finally {
    await browser.close();
  }
});

test("rejects an Inspro SPA that switches tenants after list navigation", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const listUrl = "https://benefits.inspro.com.sg/neutradc/insurance-claim-admin";
    const page = await browser.newPage();
    await page.route(listUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
          <table id="claims">
            <tbody>
              <tr class="claim-row"><td>STM-016740</td><td>Submitted</td></tr>
            </tbody>
          </table>
          <script>
            setTimeout(() => {
              history.replaceState({}, '', '/stm/insurance-claim-admin');
            }, 100);
          </script>
        `,
      }),
    );
    await page.goto(listUrl);

    await assert.rejects(
      scrapeListPage(
        page,
        {
          tableSelector: "#claims",
          rowSelector: "tbody > tr.claim-row",
          columns: [
            { name: "Claim ID", selector: "td:nth-child(1)" },
            { name: "Status", selector: "td:nth-child(2)" },
          ],
        },
        { expectedListUrl: listUrl },
      ),
      /different tenant/i,
    );
  } finally {
    await browser.close();
  }
});
