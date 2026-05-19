import { Page } from "playwright";
import { logger } from "@/lib/logger";

const MAX_SCREENSHOT_DIMENSION = 7500;

export async function capturePageScreenshot(page: Page): Promise<Buffer> {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const needsClip = width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION;

  const buffer = await page.screenshot({
    fullPage: !needsClip,
    type: "png",
    ...(needsClip
      ? {
          clip: {
            x: 0,
            y: 0,
            width: Math.min(width, MAX_SCREENSHOT_DIMENSION),
            height: Math.min(height, MAX_SCREENSHOT_DIMENSION),
          },
        }
      : {}),
  });

  logger.info(
    { size: buffer.length, pageWidth: width, pageHeight: height, clipped: needsClip },
    "[playwright] Captured page screenshot"
  );

  return Buffer.from(buffer);
}

/**
 * Extracts a simplified HTML snapshot of the page for AI analysis.
 * Strips scripts, styles, and large attributes to reduce token usage.
 */
export async function captureSimplifiedHtml(page: Page): Promise<string> {
  const html = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;

    // Remove scripts, styles, and non-visible elements
    const removeTags = ["script", "style", "noscript", "svg", "iframe"];
    for (const tag of removeTags) {
      clone.querySelectorAll(tag).forEach((el) => el.remove());
    }

    // Remove large attributes
    clone.querySelectorAll("*").forEach((el) => {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (["style", "onload", "onerror", "data-reactroot"].includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
        // Truncate very long attribute values
        if (attr.value.length > 200) {
          el.setAttribute(attr.name, attr.value.slice(0, 200) + "...");
        }
      }
    });

    return clone.outerHTML;
  });

  // Truncate to ~50KB to stay within AI context limits
  const maxLength = 50_000;
  const truncated = html.length > maxLength
    ? html.slice(0, maxLength) + "\n<!-- HTML truncated -->"
    : html;

  logger.info(
    { originalLength: html.length, truncatedLength: truncated.length },
    "[playwright] Captured simplified HTML"
  );

  return truncated;
}
