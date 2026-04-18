import { z } from "zod";

export const copilotIntentSchema = z.object({
  intent_type: z.enum(["start_order", "topup_campaign", "explain_order", "adjust_order"]),
  budget_target: z.number().positive().nullable(),
  prefer_campaign: z.boolean().nullable(),
  prefer_frequent_items: z.boolean().nullable(),
  avoid_new_products: z.boolean().nullable(),
  risk_mode: z.enum(["conservative", "balanced", "aggressive"]).nullable(),
  must_have_keywords: z.array(z.string().min(1)).default([]),
  exclude_keywords: z.array(z.string().min(1)).default([]),
});

export const copilotSelectBestComboSchema = z.object({
  status: z.enum(["selected", "blocked"]),
  combo_id: z.string().min(1).optional(),
  explanation: z.string().min(1),
  blocked_reason: z.string().min(1).optional(),
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
