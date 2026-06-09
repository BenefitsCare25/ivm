import { z } from "zod";

const aliasArray = z
  .array(z.string().trim().min(1).max(200))
  .max(50, "Up to 50 aliases")
  .default([])
  // De-duplicate (case-insensitive) and drop blanks.
  .transform((arr) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of arr) {
      const key = a.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  });

export const createDocumentTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  aliases: aliasArray,
  requiredFields: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .default([]),
  isActive: z.boolean().default(true),
});

export const updateDocumentTypeSchema = createDocumentTypeSchema.partial();

/** Feedback-loop: append a misclassified label as an alias to a known type. */
export const learnAliasSchema = z.object({
  /** Canonical document type to teach (matched/created by name). */
  documentTypeName: z.string().trim().min(1).max(200),
  /** The label the AI produced that should map to the canonical type. */
  alias: z.string().trim().min(1).max(200),
});

export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeSchema>;
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeSchema>;
export type LearnAliasInput = z.infer<typeof learnAliasSchema>;
