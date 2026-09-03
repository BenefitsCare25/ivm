import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updatePortalSchema } from "@/lib/validations/portal";
import { errorResponse, UnauthorizedError, NotFoundError, ValidationError } from "@/lib/errors";
import { getConnectedAIModelOptions, parsePortalAISelection } from "@/lib/ai/connected-models";
import type { ModelPreferences } from "@/lib/validations/api-key";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;

    const portal = await db.portal.findFirst({
      where: { id, userId: session.user.id },
      include: {
        credential: {
          select: {
            id: true,
            encryptedUsername: true,
            cookieData: true,
            cookieExpiresAt: true,
          },
        },
        scrapeSessions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            status: true,
            triggeredBy: true,
            itemsFound: true,
            itemsProcessed: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!portal) throw new NotFoundError("Portal");

    return NextResponse.json({
      id: portal.id,
      name: portal.name,
      baseUrl: portal.baseUrl,
      authMethod: portal.authMethod,
      listPageUrl: portal.listPageUrl,
      listSelectors: portal.listSelectors,
      detailSelectors: portal.detailSelectors,
      scrapeLimit: portal.scrapeLimit,
      scrapeFilters: portal.scrapeFilters,
      defaultDocumentTypeIds: portal.defaultDocumentTypeIds,
      scheduleEnabled: portal.scheduleEnabled,
      scheduleCron: portal.scheduleCron,
      hasCredentials: !!portal.credential?.encryptedUsername,
      hasCookies: !!portal.credential?.cookieData,
      cookieExpiresAt: portal.credential?.cookieExpiresAt,
      scrapeSessions: portal.scrapeSessions,
      createdAt: portal.createdAt,
      updatedAt: portal.updatedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const { id } = await params;
    const body = await req.json();
    const parsed = updatePortalSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.comparisonModel) {
      const selection = parsePortalAISelection(parsed.data.comparisonModel);
      if (!selection) {
        throw new ValidationError("Select a model from one of your connected AI providers.");
      }
      const aiSettings = await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          modelPreferences: true,
          apiKeys: { where: { isActive: true }, select: { provider: true } },
        },
      });
      const available = getConnectedAIModelOptions(
        aiSettings?.apiKeys.map((key) => key.provider) ?? [],
        (aiSettings?.modelPreferences as ModelPreferences | null) ?? null
      );
      if (!available.some((model) => model.value === parsed.data.comparisonModel)) {
        throw new ValidationError("That AI model is not available through an active connection.");
      }
    }

    const updated = await db.portal.updateMany({
      where: { id, userId: session.user.id },
      data: parsed.data,
    });

    if (updated.count === 0) throw new NotFoundError("Portal");

    return NextResponse.json({ success: true });
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

    const deleted = await db.portal.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (deleted.count === 0) throw new NotFoundError("Portal");

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
