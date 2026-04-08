import { z } from "zod";
import { FIELD_TYPES } from "@/types/extraction";

const extractedFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  value: z.string().max(5000),
  fieldType: z.enum(FIELD_TYPES),
  confidence: z.number().min(0).max(1),
});

export const updateExtractionFieldsSchema = z.object({
  fields: z.array(extractedFieldSchema).min(1, "At least one field is required"),
});

export type UpdateExtractionFieldsInput = z.infer<typeof updateExtractionFieldsSchema>;
