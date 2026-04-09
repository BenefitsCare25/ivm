import { z } from "zod";
import { MATCH_STRATEGIES } from "@/types/intelligence";

// ─── Reference Datasets ──────────────────────────────────────────

export const createReferenceDatasetSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
});

export type CreateReferenceDatasetInput = z.infer<typeof createReferenceDatasetSchema>;

export const updateReferenceDatasetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateReferenceDatasetInput = z.infer<typeof updateReferenceDatasetSchema>;

// ─── Reference Entries ───────────────────────────────────────────

export const addReferenceEntriesSchema = z.object({
  columns: z.array(z.string().min(1)).min(1, "At least one column is required"),
  rows: z.array(z.array(z.string())).min(1, "At least one row is required"),
});

export type AddReferenceEntriesInput = z.infer<typeof addReferenceEntriesSchema>;

// ─── Code Mapping Rules ──────────────────────────────────────────

export const createCodeMappingRuleSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  sourceFieldLabel: z.string().min(1, "Source field label is required").max(200),
  datasetId: z.string().min(1, "Dataset is required"),
  lookupColumn: z.string().min(1, "Lookup column is required").max(200),
  outputColumn: z.string().min(1, "Output column is required").max(200),
  matchStrategy: z.enum(MATCH_STRATEGIES),
  isActive: z.boolean().default(true),
});

export type CreateCodeMappingRuleInput = z.infer<typeof createCodeMappingRuleSchema>;

export const updateCodeMappingRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceFieldLabel: z.string().min(1).max(200).optional(),
  datasetId: z.string().min(1).optional(),
  lookupColumn: z.string().min(1).max(200).optional(),
  outputColumn: z.string().min(1).max(200).optional(),
  matchStrategy: z.enum(MATCH_STRATEGIES).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCodeMappingRuleInput = z.infer<typeof updateCodeMappingRuleSchema>;
