import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { saveCredentialsSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = saveCredentialsSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!portal) throw new NotFoundError("Portal");

    await db.portalCredential.upsert({
      where: { portalId: id },
      create: {
        portalId: id,
        encryptedUsername: encrypt(parsed.data.username),
        encryptedPassword: encrypt(parsed.data.password),
      },
      update: {
        encryptedUsername: encrypt(parsed.data.username),
        encryptedPassword: encrypt(parsed.data.password),
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!portal) throw new NotFoundError("Portal");

    await db.portalCredential.deleteMany({ where: { portalId: id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
