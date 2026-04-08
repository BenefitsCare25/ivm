import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse, UnauthorizedError, NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const fillSession = await db.fillSession.findFirst({
      where: { id, userId: session.user.id },
      include: {
        sourceAssets: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
        extractionResults: {
          select: {
            id: true,
            provider: true,
            documentType: true,
            fields: true,
            status: true,
            completedAt: true,
          },
        },
        targetAssets: {
          select: {
            id: true,
            targetType: true,
            url: true,
            fileName: true,
            detectedFields: true,
            isSupported: true,
            inspectedAt: true,
          },
        },
        mappingSets: {
          select: {
            id: true,
            status: true,
            mappings: true,
            proposedAt: true,
            reviewedAt: true,
          },
        },
        fillActions: {
          select: {
            id: true,
            targetFieldId: true,
            intendedValue: true,
            appliedValue: true,
            verifiedValue: true,
            status: true,
            errorMessage: true,
            appliedAt: true,
            verifiedAt: true,
          },
        },
        auditEvents: {
          orderBy: { timestamp: "asc" },
          select: {
            id: true,
            eventType: true,
            actor: true,
            payload: true,
            timestamp: true,
          },
        },
      },
    });

    if (!fillSession) throw new NotFoundError("Session", id);

    const exportData = {
      exportedAt: new Date().toISOString(),
      session: {
        id: fillSession.id,
        title: fillSession.title,
        description: fillSession.description,
        status: fillSession.status,
        currentStep: fillSession.currentStep,
        createdAt: fillSession.createdAt.toISOString(),
        updatedAt: fillSession.updatedAt.toISOString(),
      },
      sourceAssets: fillSession.sourceAssets,
      extractionResults: fillSession.extractionResults,
      targetAssets: fillSession.targetAssets,
      mappingSets: fillSession.mappingSets,
      fillActions: fillSession.fillActions,
      auditEvents: fillSession.auditEvents,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="session-${id}-export.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
