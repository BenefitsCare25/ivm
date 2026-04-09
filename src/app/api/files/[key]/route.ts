import { auth } from "@/lib/auth";
import { getStorageAdapter } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { globalLimiter } from "@/lib/rate-limit";
import { EXTENSION_TO_MIME } from "@/lib/validations/upload";

function getMimeType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
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
