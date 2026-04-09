import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { addReferenceEntriesSchema } from "@/lib/validations/intelligence-phase2";
import { logger } from "@/lib/logger";
import {
  errorResponse,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;

    const dataset = await db.referenceDataset.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!dataset) throw new NotFoundError("Reference dataset");

    const entries = await db.referenceEntry.findMany({
      where: { datasetId: id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return NextResponse.json(entries);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi();

    const { id } = await params;

    const dataset = await db.referenceDataset.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!dataset) throw new NotFoundError("Reference dataset");

    const body = await req.json();
    const parsed = addReferenceEntriesSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { columns, rows } = parsed.data;

    const entries = rows.map((row) => {
      const data: Record<string, string> = {};
      columns.forEach((col, i) => {
        data[col] = row[i] ?? "";
      });
      const searchText = columns.join(" ") + " " + row.join(" ");
      return { datasetId: id, data: JSON.parse(JSON.stringify(data)), searchText };
    });

    const { count: inserted } = await db.referenceEntry.createMany({ data: entries });

    await db.referenceDataset.updateMany({
      where: { id, userId: session.user.id },
      data: {
        columns: JSON.parse(JSON.stringify(columns)),
        rowCount: { increment: inserted },
        version: { increment: 1 },
      },
    });

    logger.info({ datasetId: id, inserted, userId: session.user.id }, "Reference entries inserted");

    return NextResponse.json({ inserted }, { status: 201 });
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

    const dataset = await db.referenceDataset.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!dataset) throw new NotFoundError("Reference dataset");

    await db.referenceEntry.deleteMany({ where: { datasetId: id } });

    await db.referenceDataset.updateMany({
      where: { id, userId: session.user.id },
      data: { rowCount: 0 },
    });

    logger.info({ datasetId: id, userId: session.user.id }, "Reference entries cleared");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
