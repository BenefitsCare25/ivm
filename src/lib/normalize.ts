/**
 * Canonical string normalization for document-type / name matching.
 *
 * Single source of truth shared by the backend classifier (which decides whether
 * an extracted document type canonically matches a library entry) and the UI
 * "Matches library" indicator. Keeping one implementation guarantees the badge
 * the user sees can never disagree with the backend's actual matching.
 *
 * Pure and dependency-free so it is safe to import from both server and client.
 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
