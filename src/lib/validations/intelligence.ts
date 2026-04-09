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

// ─── Document Sets ───────────────────────────────────────────────

const documentSetItemSchema = z.object({
  documentTypeId: z.string().min(1, "Document type is required"),
  isRequired: z.boolean().default(true),
  minCount: z.number().int().min(0).default(1),
  maxCount: z.number().int().min(1).optional().nullable(),
});

export const createDocumentSetSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  items: z.array(documentSetItemSchema).min(1, "At least one document type required"),
});

export type CreateDocumentSetInput = z.infer<typeof createDocumentSetSchema>;

export const updateDocumentSetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  items: z.array(documentSetItemSchema).optional(),
});

export type UpdateDocumentSetInput = z.infer<typeof updateDocumentSetSchema>;
