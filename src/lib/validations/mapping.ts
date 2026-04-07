import { z } from "zod";

export const reviewMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        id: z.string().min(1),
        userApproved: z.boolean(),
        userOverrideValue: z.string().optional(),
      })
    )
    .min(1, "At least one mapping decision is required"),
});

export type ReviewMappingInput = z.infer<typeof reviewMappingSchema>;
