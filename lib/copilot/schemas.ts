import { z } from "zod";

const optionalNonEmptyStringSchema = z.preprocess((value) => {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

const copilotRiskModeSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "budget_control" || normalized === "budget_constraint") {
    return "conservative";
  }

  return normalized;
}, z.enum(["conservative", "balanced", "aggressive"]).nullable());

const copilotSelectStatusSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return value;
  }
  if (normalized === "success") {
    return "selected";
  }

  return normalized;
}, z.enum(["selected", "blocked"]));

export const copilotIntentSchema = z.object({
  intent_type: z.enum([
    "start_order",
    "topup_campaign",
    "explain_order",
    "adjust_order",
    "mixed",
  ]),
  budget_target: z.number().positive().nullable(),
  prefer_campaign: z.boolean().nullable(),
  prefer_frequent_items: z.boolean().nullable(),
  avoid_new_products: z.boolean().nullable(),
  risk_mode: copilotRiskModeSchema,
  must_have_keywords: z.array(z.string().min(1)).default([]),
  exclude_keywords: z.array(z.string().min(1)).default([]),
});

export const copilotSelectBestComboSchema = z.object({
  status: copilotSelectStatusSchema,
  combo_id: optionalNonEmptyStringSchema,
  explanation: z.string().min(1),
  blocked_reason: optionalNonEmptyStringSchema,
});

export const copilotSummarizeResultSchema = z.object({
  summary: z.string().min(1),
  should_go_checkout: z.boolean().default(false),
  key_points: z.array(z.string().min(1)).default([]),
});

export const copilotAutofillRequestSchema = z.object({
  customerId: z.string().min(1),
  message: z.string().min(1),
  pageName: z.enum(["/purchase", "/order-submit"]).optional(),
});

export const copilotChatRequestSchema = z.object({
  customerId: z.string().min(1),
  message: z.string().min(1),
  pageName: z.enum(["/purchase", "/order-submit"]).optional(),
});

export const copilotApplyDraftRequestSchema = z.object({
  customerId: z.string().min(1).optional(),
});

export type CopilotIntentOutput = z.infer<typeof copilotIntentSchema>;
export type CopilotSelectBestComboOutput = z.infer<typeof copilotSelectBestComboSchema>;
export type CopilotSummarizeResultOutput = z.infer<typeof copilotSummarizeResultSchema>;
export type CopilotAutofillRequest = z.infer<typeof copilotAutofillRequestSchema>;
export type CopilotChatRequest = z.infer<typeof copilotChatRequestSchema>;
export type CopilotApplyDraftRequest = z.infer<typeof copilotApplyDraftRequestSchema>;
