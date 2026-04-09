import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "intelligence-classifier" });

export interface ClassificationResult {
  documentTypeId: string | null;
  documentTypeName: string | null;
  confidence: number;
  matchedOn: "exact_name" | "alias" | "fuzzy_name" | "fuzzy_alias" | null;
}

export interface DocTypeRecord {
  id: string;
  name: string;
  aliases: unknown;
  requiredFields?: unknown;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(aLen, bLen) / 2) - 1, 0);
  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / aLen + matches / bLen + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(aLen, bLen)); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

const FUZZY_THRESHOLD = 0.85;

const NO_MATCH: ClassificationResult = {
  documentTypeId: null,
  documentTypeName: null,
  confidence: 0,
  matchedOn: null,
};

export async function fetchDocTypes(userId: string): Promise<DocTypeRecord[]> {
  return db.documentType.findMany({
    where: { userId, isActive: true },
    select: { id: true, name: true, aliases: true, requiredFields: true },
  });
}

export function classifyDocumentTypeFromCache(
  aiDocumentType: string,
  docTypes: DocTypeRecord[]
): ClassificationResult {
  if (!aiDocumentType?.trim() || docTypes.length === 0) return NO_MATCH;

  const inputNorm = normalize(aiDocumentType);
  let best: ClassificationResult = NO_MATCH;

  for (const dt of docTypes) {
    const nameNorm = normalize(dt.name);
    const aliases = (dt.aliases as string[]) ?? [];

    if (inputNorm === nameNorm) {
      return { documentTypeId: dt.id, documentTypeName: dt.name, confidence: 1.0, matchedOn: "exact_name" };
    }

    for (const alias of aliases) {
      if (normalize(alias) === inputNorm) {
        return { documentTypeId: dt.id, documentTypeName: dt.name, confidence: 0.95, matchedOn: "alias" };
      }
    }

    const nameSim = jaroWinkler(inputNorm, nameNorm);
    if (nameSim >= FUZZY_THRESHOLD && nameSim > best.confidence) {
      best = { documentTypeId: dt.id, documentTypeName: dt.name, confidence: nameSim, matchedOn: "fuzzy_name" };
    }

    for (const alias of aliases) {
      const aliasSim = jaroWinkler(inputNorm, normalize(alias));
      if (aliasSim >= FUZZY_THRESHOLD && aliasSim > best.confidence) {
        best = { documentTypeId: dt.id, documentTypeName: dt.name, confidence: aliasSim, matchedOn: "fuzzy_alias" };
      }
    }
  }

  if (best.documentTypeId) {
    log.info(
      { input: aiDocumentType, matched: best.documentTypeName, confidence: best.confidence, matchedOn: best.matchedOn },
      "Document type classified"
    );
  }

  return best;
}

export async function classifyDocumentType(
  userId: string,
  aiDocumentType: string,
  cachedDocTypes?: DocTypeRecord[]
): Promise<ClassificationResult> {
  const docTypes = cachedDocTypes ?? (await fetchDocTypes(userId));
  return classifyDocumentTypeFromCache(aiDocumentType, docTypes);
}
