import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { RasterImage } from "./types";

let domGlobalsReady = false;

/**
 * pdfjs (used by pdf-to-img) expects browser globals like DOMMatrix / Path2D /
 * ImageData when a PDF uses matrix transforms or inline images. They don't exist
 * in Node, which throws "Expected DOMMatrix" on such PDFs. Polyfill them once
 * from node-canvas (already a dependency). Idempotent + best-effort.
 */
async function ensurePdfDomGlobals(): Promise<void> {
  if (domGlobalsReady) return;
  domGlobalsReady = true;
  try {
    const canvasMod = (await import("canvas")) as unknown as Record<string, unknown> & { default?: Record<string, unknown> };
    const g = globalThis as unknown as Record<string, unknown>;
    for (const name of ["DOMMatrix", "Path2D", "ImageData", "DOMPoint", "DOMRect"]) {
      const impl = canvasMod[name] ?? canvasMod.default?.[name];
      if (impl && typeof g[name] === "undefined") g[name] = impl;
    }
  } catch (err) {
    logger.warn({ err }, "[pdf-raster] Could not load canvas DOM polyfills — some PDFs may fail to rasterize");
  }
}

/**
 * Convert a PDF buffer into an array of PNG page images.
 *
 * Used only by the local (oMLX / Qwen3-VL) provider path: local vision models
 * accept images, not PDFs, unlike the cloud Claude/OpenAI proxies which translate
 * PDF blocks natively. Backed by `pdf-to-img` (@napi-rs/canvas prebuilt binaries —
 * no system libraries required on Linux).
 *
 * @param pdf   Raw PDF bytes.
 * @param opts  maxPages caps how many pages are sent (bounds context + latency);
 *              scale controls render resolution (higher = sharper but larger).
 */
export async function rasterizePdfToImages(
  pdf: Buffer,
  opts: { maxPages?: number; scale?: number } = {}
): Promise<RasterImage[]> {
  const maxPages = opts.maxPages ?? 10;
  const scale = opts.scale ?? 2.5;

  let pdfModule: typeof import("pdf-to-img");
  try {
    pdfModule = await import("pdf-to-img");
  } catch (err) {
    logger.error({ err }, "[pdf-raster] pdf-to-img not installed");
    throw new AppError(
      "PDF rasterization dependency (pdf-to-img) is not installed. Run `npm install` on the server.",
      500,
      "PDF_RASTER_UNAVAILABLE"
    );
  }

  await ensurePdfDomGlobals();

  try {
    const document = await pdfModule.pdf(new Uint8Array(pdf), { scale });
    const images: RasterImage[] = [];
    for await (const page of document) {
      images.push({ data: Buffer.from(page), mimeType: "image/png" });
      if (images.length >= maxPages) break;
    }

    if (images.length === 0) {
      throw new AppError("PDF produced no rasterizable pages", 422, "PDF_RASTER_EMPTY");
    }

    if (document.length > maxPages) {
      logger.warn(
        { totalPages: document.length, sentPages: maxPages },
        "[pdf-raster] PDF truncated for local vision model — only first pages sent"
      );
    }

    return images;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err }, "[pdf-raster] rasterization failed");
    throw new AppError(
      `Failed to rasterize PDF for local model: ${err instanceof Error ? err.message : String(err)}`,
      500,
      "PDF_RASTER_FAILED"
    );
  }
}
