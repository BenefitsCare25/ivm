import { db } from "@/lib/db";

const ACTIVE_SESSION_STATUSES = ["PENDING", "RUNNING"] as const;
const ACTIVE_ITEM_STATUSES = ["DISCOVERED", "PROCESSING"] as const;

interface CreateScrapeSessionInput {
  portalId: string;
  triggeredBy: "MANUAL" | "SCHEDULED";
  acceptableDocumentTypeIds?: string[];
  submittedFrom?: Date | null;
  submittedTo?: Date | null;
}

type CreateScrapeSessionResult =
  | { created: true; sessionId: string }
  | { created: false; activeSessionId: string };

export async function createScrapeSessionIfIdle(
  input: CreateScrapeSessionInput,
): Promise<CreateScrapeSessionResult> {
  return db.$transaction(async (tx) => {
    const lockKey = `portal-scrape:${input.portalId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const activeSession = await tx.scrapeSession.findFirst({
      where: {
        portalId: input.portalId,
        OR: [
          { status: { in: [...ACTIVE_SESSION_STATUSES] } },
          {
            status: { in: ["COMPLETED", "FAILED"] },
            trackedItems: { some: { status: { in: [...ACTIVE_ITEM_STATUSES] } } },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (activeSession) {
      return { created: false, activeSessionId: activeSession.id };
    }

    const session = await tx.scrapeSession.create({
      data: {
        portalId: input.portalId,
        triggeredBy: input.triggeredBy,
        acceptableDocumentTypeIds: input.acceptableDocumentTypeIds ?? [],
        submittedFrom: input.submittedFrom ?? null,
        submittedTo: input.submittedTo ?? null,
      },
      select: { id: true },
    });

    return { created: true, sessionId: session.id };
  });
}
