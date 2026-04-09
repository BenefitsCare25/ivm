import { z } from "zod";

const expectedFieldSchema = z.object({
  label: z.string().min(1),
  fieldType: z.string().min(1),
  required: z.boolean(),
  aliases: z.array(z.string()),
});

export const createExtractionTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  documentTypeId: z.string().optional().nullable(),
  expectedFields: z.array(expectedFieldSchema).default([]),
  instructions: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export type CreateExtractionTemplateInput = z.infer<typeof createExtractionTemplateSchema>;

export const updateExtractionTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  documentTypeId: z.string().optional().nullable(),
  expectedFields: z.array(expectedFieldSchema).optional(),
  instructions: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateExtractionTemplateInput = z.infer<typeof updateExtractionTemplateSchema>;

export const createNormalizationRuleSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  fieldType: z.string().min(1, "Field type is required"),
  pattern: z.string().optional().nullable(),
  outputFormat: z.string().min(1, "Output format is required"),
  isActive: z.boolean().default(true),
});

export type CreateNormalizationRuleInput = z.infer<typeof createNormalizationRuleSchema>;

export const updateNormalizationRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fieldType: z.string().min(1).optional(),
  pattern: z.string().optional().nullable(),
  outputFormat: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateNormalizationRuleInput = z.infer<typeof updateNormalizationRuleSchema>;

export const upsertEscalationConfigSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1),
  autoFlagLowConfidence: z.boolean(),
  escalationMessage: z.string().min(1).max(500),
});

export type UpsertEscalationConfigInput = z.infer<typeof upsertEscalationConfigSchema>;
