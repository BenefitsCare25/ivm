import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { preferredProviderSchema } from "@/lib/validations/api-key";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = preferredProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid provider");
    }

    const { provider } = parsed.data;

    const key = await db.userApiKey.findUnique({
      where: { userId_provider: { userId: session.user.id, provider } },
    });
    if (!key) {
      throw new ValidationError(`No API key saved for ${provider}. Add a key first.`);
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { preferredProvider: provider },
    });

    return NextResponse.json({ preferredProvider: provider });
  } catch (err) {
    return errorResponse(err);
  }
}
