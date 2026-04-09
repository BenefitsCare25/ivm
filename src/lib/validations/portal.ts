import { z } from "zod";

export const createPortalSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(200, "Name must be under 200 characters"),
  baseUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2000, "URL must be under 2000 characters"),
  authMethod: z.enum(["COOKIES", "CREDENTIALS"]).default("COOKIES"),
  listPageUrl: z
    .string()
    .url("Must be a valid URL")
    .max(2000)
    .optional()
    .nullable(),
});

export type CreatePortalInput = z.infer<typeof createPortalSchema>;

export const updatePortalSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().max(2000).optional(),
  authMethod: z.enum(["COOKIES", "CREDENTIALS"]).optional(),
  listPageUrl: z.string().url().max(2000).optional().nullable(),
});

export type UpdatePortalInput = z.infer<typeof updatePortalSchema>;

const selectorField = z.string().max(500).optional().nullable();

export const updateSelectorsSchema = z.object({
  listSelectors: z.object({
    tableSelector: selectorField,
    rowSelector: selectorField,
    columns: z.array(z.object({
      name: z.string().max(200),
      selector: z.string().max(500),
    })).max(50).optional().nullable(),
    detailLinkSelector: selectorField,
    paginationSelector: selectorField,
  }).optional(),
  detailSelectors: z.object({
    fieldSelectors: z.record(z.string().max(200), z.string().max(500)).optional().nullable(),
    downloadLinkSelector: selectorField,
    fileNameSelector: selectorField,
  }).optional(),
});

export type UpdateSelectorsInput = z.infer<typeof updateSelectorsSchema>;

export const saveCredentialsSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type SaveCredentialsInput = z.infer<typeof saveCredentialsSchema>;

export const saveCookiesSchema = z.object({
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string().default("/"),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })),
  expiresAt: z.string().datetime().optional(),
});

export type SaveCookiesInput = z.infer<typeof saveCookiesSchema>;

const CRON_REGEX = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

export const updateScheduleSchema = z.object({
  enabled: z.boolean(),
  cron: z
    .string()
    .max(100)
    .refine((v) => CRON_REGEX.test(v.trim()), { message: "Invalid cron expression (expected 5 fields)" })
    .optional()
    .nullable(),
});

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export const updateTrackedItemSchema = z.object({
  status: z.enum(["VERIFIED", "FLAGGED"]),
});

export type UpdateTrackedItemInput = z.infer<typeof updateTrackedItemSchema>;
