import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createReferenceDatasetSchema } from "@/lib/validations/intelligence-phase2";
import { logger } from "@/lib/logger";
import { errorResponse, UnauthorizedError, ValidationError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const datasets = await db.referenceDataset.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { entries: true } },
      },
    });

    return NextResponse.json(datasets);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = createReferenceDatasetSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const dataset = await db.referenceDataset.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        columns: JSON.parse(JSON.stringify([])),
        rowCount: 0,
        sourceType: "manual",
        version: 1,
      },
    });

    logger.info({ datasetId: dataset.id, userId: session.user.id }, "Reference dataset created");

    return NextResponse.json(dataset, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
