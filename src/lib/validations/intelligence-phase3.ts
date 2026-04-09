import { z } from "zod";

const ruleConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "is_empty",
    "is_not_empty",
    "matches_regex",
  ]),
  value: z.union([z.string(), z.number()]),
  value2: z.number().optional(),
});

const ruleConditionsSchema = z.object({
  logic: z.enum(["AND", "OR"]),
  conditions: z.array(ruleConditionSchema),
});

const ruleActionSchema = z.object({
  type: z.enum(["FLAG", "SET_STATUS", "ADD_NOTE", "SET_FIELD", "ESCALATE", "SKIP"]),
  params: z.record(z.string(), z.string()),
});

const ruleScopeSchema = z
  .object({
    documentTypes: z.array(z.string()).optional(),
    portalIds: z.array(z.string()).optional(),
  })
  .optional();

export const createBusinessRuleSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  priority: z.number().int().default(0),
  triggerPoint: z.enum(["POST_EXTRACTION", "POST_COMPARISON", "POST_MAPPING"]),
  conditions: ruleConditionsSchema,
  actions: z.array(ruleActionSchema),
  isActive: z.boolean().default(true),
  scope: ruleScopeSchema,
});

export type CreateBusinessRuleInput = z.infer<typeof createBusinessRuleSchema>;

export const updateBusinessRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  priority: z.number().int().optional(),
  triggerPoint: z.enum(["POST_EXTRACTION", "POST_COMPARISON", "POST_MAPPING"]).optional(),
  conditions: ruleConditionsSchema.optional(),
  actions: z.array(ruleActionSchema).optional(),
  isActive: z.boolean().optional(),
  scope: ruleScopeSchema,
});

export type UpdateBusinessRuleInput = z.infer<typeof updateBusinessRuleSchema>;
