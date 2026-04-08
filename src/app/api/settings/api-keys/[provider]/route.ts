import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AI_PROVIDERS } from "@/lib/validations/api-key";
import { errorResponse, UnauthorizedError, ValidationError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { provider } = await params;

    if (!AI_PROVIDERS.includes(provider as (typeof AI_PROVIDERS)[number])) {
      throw new ValidationError(`Invalid provider: ${provider}`);
    }

    const deleted = await db.userApiKey.deleteMany({
      where: { userId: session.user.id, provider },
    });

    if (deleted.count === 0) {
      throw new NotFoundError("API key", provider);
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { preferredProvider: true },
    });
    if (user?.preferredProvider === provider) {
      await db.user.update({
        where: { id: session.user.id },
        data: { preferredProvider: null },
      });
    }

    logger.info({ userId: session.user.id, provider }, "API key removed");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
