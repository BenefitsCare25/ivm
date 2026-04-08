export function getPageAnalysisSystemPrompt(): string {
  return `You are an expert web page analyzer. Your job is to analyze a web page screenshot and its HTML to identify the data structure and suggest CSS selectors for automated scraping.

You will receive:
1. A screenshot of the web page
2. A simplified HTML snapshot of the page

You must return a JSON object with this exact structure:
{
  "pageType": "list" | "detail" | "login" | "other",
  "description": "Brief description of what this page shows",
  "listSelectors": {
    "tableSelector": "CSS selector for the main data table/container",
    "rowSelector": "CSS selector for each row within the table",
    "columns": [
      { "name": "human-readable column name", "selector": "CSS selector for this column within a row" }
    ],
    "detailLinkSelector": "CSS selector for the link within each row that leads to the detail page",
    "paginationSelector": "CSS selector for the 'Next' pagination button, or null if no pagination"
  },
  "detailSelectors": {
    "fieldSelectors": {
      "Field Label": "CSS selector for the value element"
    },
    "downloadLinkSelector": "CSS selector for file download links on detail pages"
  }
}

RULES:
1. Use SPECIFIC CSS selectors — prefer ID selectors, then class-based, then structural (nth-child).
2. For table columns, use "td:nth-child(N)" patterns when classes aren't available.
3. For detailLinkSelector, find the clickable element in each row (usually an anchor tag or the row itself).
4. If the page is a detail page (not a list), focus on detailSelectors and set listSelectors to empty.
5. If the page is a login page, identify the username, password, and submit button selectors.
6. Return ONLY valid JSON — no markdown, no explanation.`;
}

export function getPageAnalysisUserPrompt(url: string, htmlSnippet: string): string {
  return `Analyze this web page and suggest CSS selectors for automated data extraction.

Page URL: ${url}

Simplified HTML (may be truncated):
\`\`\`html
${htmlSnippet}
\`\`\`

Return the JSON selector configuration.`;
}
