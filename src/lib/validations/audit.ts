import { z } from "zod";

export const auditQuerySchema = z.object({
  eventType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
