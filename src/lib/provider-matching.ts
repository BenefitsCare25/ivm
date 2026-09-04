/**
 * Normalize provider names for resilient, deterministic group matching.
 * Ampersands and "and" are equivalent; punctuation, apostrophe style, accents,
 * casing, and repeated whitespace do not affect the result.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fuzzyMatchProvider(itemValue: string, normalizedMembers: string[]): boolean {
  const normalized = normalizeForMatch(itemValue);
  if (!normalized) return false;

  return normalizedMembers.some((member) => {
    const candidate = normalizeForMatch(member);
    if (!candidate) return false;

    // Phrase boundaries retain useful alias behaviour (a configured hospital
    // name still matches a portal value with a legal suffix) without allowing
    // partial-word collisions.
    return (
      ` ${normalized} `.includes(` ${candidate} `) ||
      ` ${candidate} `.includes(` ${normalized} `)
    );
  });
}
