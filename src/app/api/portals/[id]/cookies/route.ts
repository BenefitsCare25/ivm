import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCookiesSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { toInputJson } from "@/lib/utils";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = saveCookiesSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!portal) throw new NotFoundError("Portal");

    const expiresAt = parsed.data.expiresAt
      ? new Date(parsed.data.expiresAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default: 24 hours

    await db.portalCredential.upsert({
      where: { portalId: id },
      create: {
        portalId: id,
        cookieData: toInputJson(parsed.data.cookies),
        cookieExpiresAt: expiresAt,
      },
      update: {
        cookieData: toInputJson(parsed.data.cookies),
        cookieExpiresAt: expiresAt,
      },
    });

    return NextResponse.json({ success: true, expiresAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
