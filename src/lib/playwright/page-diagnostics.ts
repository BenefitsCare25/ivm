import type { ConsoleMessage, Page, Request, Response } from "playwright";

const MAX_ENTRIES = 40;
const MAX_MESSAGE_LENGTH = 500;
const TRACKED_RESOURCE_TYPES = new Set(["document", "xhr", "fetch"]);

interface ResponseDiagnostic {
  method: string;
  resourceType: string;
  status: number;
  url: string;
}

interface RequestFailureDiagnostic {
  method: string;
  resourceType: string;
  url: string;
  error: string;
}

interface ConsoleDiagnostic {
  type: string;
  text: string;
}

interface DomDiagnostic {
  url: string;
  title: string;
  bodyTextLength: number;
  htmlLength: number;
  tableCount: number;
  rowCount: number;
  interactiveElementCount: number;
  loadingIndicatorCount: number;
  scriptCount: number;
}

export interface PageDiagnosticsSnapshot {
  dom: DomDiagnostic | null;
  responses: ResponseDiagnostic[];
  requestFailures: RequestFailureDiagnostic[];
  consoleMessages: ConsoleDiagnostic[];
  pageErrors: string[];
  droppedEntries: {
    responses: number;
    requestFailures: number;
    consoleMessages: number;
    pageErrors: number;
  };
}

export interface PageDiagnosticsCollector {
  snapshot(): Promise<PageDiagnosticsSnapshot>;
  detach(): void;
}

function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrl(url))
    .replace(
      /(["']?(?:authorization|cookie|password|secret|token|api[-_]?key)["']?\s*[=:]\s*)["']?[^"'\s,;}]+["']?/gi,
      "$1[REDACTED]"
    )
    .slice(0, MAX_MESSAGE_LENGTH);
}

function pushCapped<T>(items: T[], item: T, dropped: { count: number }): void {
  if (items.length < MAX_ENTRIES) {
    items.push(item);
  } else {
    dropped.count += 1;
  }
}

/**
 * Collects secret-safe browser diagnostics for a single page. Attach this before
 * navigation so initial document/API failures and early console errors are not lost.
 */
export function attachPageDiagnostics(page: Page): PageDiagnosticsCollector {
  const responses: ResponseDiagnostic[] = [];
  const requestFailures: RequestFailureDiagnostic[] = [];
  const consoleMessages: ConsoleDiagnostic[] = [];
  const pageErrors: string[] = [];

  const droppedResponses = { count: 0 };
  const droppedRequestFailures = { count: 0 };
  const droppedConsoleMessages = { count: 0 };
  const droppedPageErrors = { count: 0 };

  const onResponse = (response: Response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!TRACKED_RESOURCE_TYPES.has(resourceType) && response.status() < 400) return;

    pushCapped(
      responses,
      {
        method: request.method(),
        resourceType,
        status: response.status(),
        url: safeUrl(response.url()),
      },
      droppedResponses
    );
  };

  const onRequestFailed = (request: Request) => {
    pushCapped(
      requestFailures,
      {
        method: request.method(),
        resourceType: request.resourceType(),
        url: safeUrl(request.url()),
        error: sanitizeMessage(request.failure()?.errorText ?? "Unknown request failure"),
      },
      droppedRequestFailures
    );
  };

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    pushCapped(
      consoleMessages,
      { type: message.type(), text: sanitizeMessage(message.text()) },
      droppedConsoleMessages
    );
  };

  const onPageError = (error: Error) => {
    pushCapped(pageErrors, sanitizeMessage(error.message), droppedPageErrors);
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    async snapshot() {
      const dom = await page
        .evaluate(() => ({
          url: `${window.location.origin}${window.location.pathname}`,
          title: document.title,
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          htmlLength: document.documentElement?.outerHTML?.length ?? 0,
          tableCount: document.querySelectorAll("table, [role='grid'], [role='table']").length,
          rowCount: document.querySelectorAll("tr, [role='row']").length,
          interactiveElementCount: document.querySelectorAll(
            "input, select, textarea, button, a[href]"
          ).length,
          loadingIndicatorCount: document.querySelectorAll(
            "[aria-busy='true'], [role='progressbar'], .spinner, .loading, .loader"
          ).length,
          scriptCount: document.scripts.length,
        }))
        .catch(() => null);

      return {
        dom,
        responses: [...responses],
        requestFailures: [...requestFailures],
        consoleMessages: [...consoleMessages],
        pageErrors: [...pageErrors],
        droppedEntries: {
          responses: droppedResponses.count,
          requestFailures: droppedRequestFailures.count,
          consoleMessages: droppedConsoleMessages.count,
          pageErrors: droppedPageErrors.count,
        },
      };
    },
    detach() {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}
