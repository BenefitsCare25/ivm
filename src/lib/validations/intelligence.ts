import { z } from "zod";

// ─── Document Types ──────────────────────────────────────────────

export const createDocumentTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  aliases: z.array(z.string().max(200)).default([]),
  category: z.string().max(100).optional().nullable(),
  requiredFields: z.array(z.string().max(200)).default([]),
});

export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeSchema>;

export const updateDocumentTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  aliases: z.array(z.string().max(200)).optional(),
  category: z.string().max(100).optional().nullable(),
  requiredFields: z.array(z.string().max(200)).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeSchema>;

