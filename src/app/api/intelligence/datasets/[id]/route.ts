import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { updateReferenceDatasetSchema } from "@/lib/validations/intelligence-phase2";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateReferenceDatasetSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const updated = await db.referenceDataset.updateMany({
      where: { id, userId: session.user.id },
      data,
    });

    if (updated.count === 0) throw new NotFoundError("Reference dataset");

    logger.info({ datasetId: id, userId: session.user.id }, "Reference dataset updated");

    const dataset = await db.referenceDataset.findFirst({
      where: { id, userId: session.user.id },
      include: { _count: { select: { entries: true } } },
    });

    return NextResponse.json(dataset);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;

    // Check if any mapping rules reference this dataset
    const ruleCount = await db.codeMappingRule.count({
      where: { datasetId: id, userId: session.user.id },
    });

    if (ruleCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${ruleCount} mapping rule${ruleCount !== 1 ? "s" : ""} reference this dataset. Remove them first.`,
        },
        { status: 409 }
      );
    }

    const deleted = await db.referenceDataset.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Reference dataset");

    logger.info({ datasetId: id, userId: session.user.id }, "Reference dataset deleted");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
