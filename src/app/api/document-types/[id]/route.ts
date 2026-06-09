import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { updateDocumentTypeSchema } from "@/lib/validations/document-type";
import { toInputJson } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id } = await params;
    const body = await req.json();
    const parsed = updateDocumentTypeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid document type");
    }

    // Name uniqueness (per user) when renaming.
    if (parsed.data.name) {
      const clash = await db.documentType.findFirst({
        where: { userId: session.user.id, name: parsed.data.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ValidationError("A document type with this name already exists");
    }

    const data: Prisma.DocumentTypeUpdateManyMutationInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.aliases !== undefined) data.aliases = toInputJson(parsed.data.aliases);
    if (parsed.data.requiredFields !== undefined) data.requiredFields = toInputJson(parsed.data.requiredFields);
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const result = await db.documentType.updateMany({
      where: { id, userId: session.user.id },
      data,
    });
    if (result.count === 0) throw new NotFoundError("Document type");

    const updated = await db.documentType.findUnique({ where: { id } });
    return NextResponse.json({ documentType: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();
    const { id } = await params;
    const result = await db.documentType.deleteMany({
      where: { id, userId: session.user.id },
    });
    if (result.count === 0) throw new NotFoundError("Document type");
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
