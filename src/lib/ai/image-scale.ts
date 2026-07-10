import { logger } from "@/lib/logger";
import type { RasterImage } from "./types";

// Local vision models (Qwen3-VL) tokenize images by resolution — a full-size phone
// photo becomes thousands of image tokens and prompt-processing blows the timeout.
// Capping the longest side keeps document text readable while cutting tokens ~10x.
const DEFAULT_MAX_DIM = 1600;

type CanvasModule = typeof import("canvas");

async function loadCanvas(): Promise<CanvasModule> {
  const mod = await import("canvas");
  // node-canvas is CJS; named exports may sit on the module or its default under ESM interop.
  const ns = mod as unknown as { createCanvas?: unknown; default?: CanvasModule };
  return (ns.createCanvas ? (mod as unknown as CanvasModule) : ns.default) as CanvasModule;
}

/**
 * Re-encode an image to a PNG whose longest side is at most `maxDim`.
 * Best-effort: throws only if the underlying decode fails (caller decides fallback).
 */
export async function downscaleImage(buffer: Buffer, maxDim = DEFAULT_MAX_DIM): Promise<RasterImage> {
  const { createCanvas, loadImage } = await loadCanvas();
  const img = await loadImage(buffer);
  const longest = Math.max(img.width, img.height) || 1;
  const scale = longest > maxDim ? maxDim / longest : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { data: canvas.toBuffer("image/png"), mimeType: "image/png" };
}

/**
 * Downscale a batch of page/source images for the local provider. Each image that
 * fails to decode falls back to the original so one bad page never fails the call.
 */
export async function downscaleImages(images: RasterImage[], maxDim = DEFAULT_MAX_DIM): Promise<RasterImage[]> {
  const out: RasterImage[] = [];
  for (const im of images) {
    try {
      out.push(await downscaleImage(im.data, maxDim));
    } catch (err) {
      logger.warn({ err }, "[image-scale] downscale failed — sending original image");
      out.push(im);
    }
  }
  return out;
}
