import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { globalLimiter } from "@/lib/rate-limit";
import { EXTENSION_TO_MIME } from "@/lib/validations/upload";

function getMimeType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * Verify the requesting user owns the resource associated with this storage key.
 * Keys are scoped by prefix: uploads/<userId>/... or portal-events/<itemId>/...
 * For uploads, the userId prefix provides implicit ownership.
 * For other keys, we verify via DB lookup.
 */
async function verifyOwnership(decodedKey: string, userId: string): Promise<boolean> {
  // User upload files: uploads/<userId>/...
  if (decodedKey.startsWith(`uploads/${userId}/`)) return true;

  // Run independent DB lookups in parallel
  const assetP = db.targetAsset.findFirst({
    where: {
      OR: [
        { storagePath: decodedKey },
        { filledStoragePath: decodedKey },
      ],
      fillSession: { userId },
    },
    select: { id: true },
  });

  const portalFileP = db.trackedItemFile.findFirst({
    where: {
      storagePath: decodedKey,
      trackedItem: { scrapeSession: { portal: { userId } } },
    },
    select: { id: true },
  });

  let eventItemP: Promise<{ id: string } | null> | null = null;
  if (decodedKey.startsWith("portal-events/")) {
    const parts = decodedKey.split("/");
    if (parts.length >= 2) {
      eventItemP = db.trackedItem.findFirst({
        where: { id: parts[1], scrapeSession: { portal: { userId } } },
        select: { id: true },
      });
    }
  }

  const [asset, portalFile, eventItem] = await Promise.all([
    assetP,
    portalFileP,
    eventItemP,
  ]);

  return !!(asset || portalFile || eventItem);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await globalLimiter(ip);
    if (!rl.allowed) {
      return new Response("Too Many Requests", { status: 429 });
    }

    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { key } = await params;
    const decodedKey = decodeURIComponent(key);

    const allowed = await verifyOwnership(decodedKey, session.user.id);
    if (!allowed) throw new NotFoundError("File", decodedKey);

    const storage = getStorageAdapter();
    let data: Buffer;

    try {
      data = await storage.download(decodedKey);
    } catch {
      throw new NotFoundError("File", decodedKey);
    }

    const contentType = getMimeType(decodedKey);

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
      },
    });
  } catch (err) {
    logger.error({ err }, "File serving error");
    return errorResponse(err);
  }
}
