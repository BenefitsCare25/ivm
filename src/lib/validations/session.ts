import { z } from "zod";

export const createSessionSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be under 200 characters"),
  description: z
    .string()
    .max(1000, "Description must be under 1000 characters")
    .optional()
    .default(""),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
