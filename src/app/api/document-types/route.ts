import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { errorResponse, ValidationError } from "@/lib/errors";
import { createDocumentTypeSchema } from "@/lib/validations/document-type";
import { toInputJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthApi();
    const docTypes = await db.documentType.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ documentTypes: docTypes });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthApi();
    const body = await req.json();
    const parsed = createDocumentTypeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid document type");
    }

    const existing = await db.documentType.findFirst({
      where: { userId: session.user.id, name: parsed.data.name },
      select: { id: true },
    });
    if (existing) throw new ValidationError("A document type with this name already exists");

    const created = await db.documentType.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        aliases: toInputJson(parsed.data.aliases),
        requiredFields: toInputJson(parsed.data.requiredFields),
        isActive: parsed.data.isActive,
      },
    });
    return NextResponse.json({ documentType: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
