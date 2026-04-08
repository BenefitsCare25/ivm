import { chromium, Browser, BrowserContext, Cookie } from "playwright";
import { logger } from "@/lib/logger";

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";

/**
 * Gets or launches a shared Chromium browser instance.
 * Intended for use in BullMQ workers only — never in API request handlers.
 * Uses a launch promise guard to prevent concurrent launches.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    logger.info({ headless: HEADLESS }, "[playwright] Launching Chromium");

    browserInstance = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    browserInstance.on("disconnected", () => {
      logger.info("[playwright] Browser disconnected");
      browserInstance = null;
      browserLaunchPromise = null;
    });

    browserLaunchPromise = null;
    return browserInstance;
  })();

  return browserLaunchPromise;
}

export interface BrowserContextOptions {
  cookies?: Cookie[];
  userAgent?: string;
  viewport?: { width: number; height: number };
}

/**
 * Creates a new browser context with optional cookies pre-injected.
 * Each scrape session should get its own context for isolation.
 */
export async function createBrowserContext(
  options: BrowserContextOptions = {}
): Promise<BrowserContext> {
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: options.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: options.viewport ?? { width: 1920, height: 1080 },
    acceptDownloads: true,
  });

  if (options.cookies?.length) {
    await context.addCookies(options.cookies);
    logger.info({ count: options.cookies.length }, "[playwright] Injected cookies");
  }

  return context;
}

/**
 * Closes the shared browser instance. Call during graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    logger.info("[playwright] Browser closed");
  }
}

/**
 * Health check — verifies Playwright can launch a browser.
 */
export async function checkBrowserHealth(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    return browser.isConnected();
  } catch (err) {
    logger.error({ err }, "[playwright] Health check failed");
    return false;
  }
}
