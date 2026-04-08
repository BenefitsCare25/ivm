import { z } from "zod";

export const executeFillSchema = z.object({
  skipFieldIds: z.array(z.string()).optional(),
});

export type ExecuteFillInput = z.infer<typeof executeFillSchema>;
