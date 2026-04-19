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
  risk_mode: z.enum(["conservative", "balanced", "aggressive"]).nullable(),
  must_have_keywords: z.array(z.string().min(1)).default([]),
  exclude_keywords: z.array(z.string().min(1)).default([]),
});

export const copilotSelectBestComboSchema = z.object({
  status: z.enum(["selected", "blocked"]),
  combo_id: optionalNonEmptyStringSchema,
  explanation: z.string().min(1),
  blocked_reason: optionalNonEmptyStringSchema,
});

export const copilotSummarizeResultSchema = z.object({
  summary: z.string().min(1),
  should_go_checkout: z.boolean().default(false),
  key_points: z.array(z.string().min(1)).default([]),
});

export const copilotImageInputSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  dataUrl: z.string().min(1),
});

const copilotInputRequestSchema = z
  .object({
    customerId: z.string().min(1),
    message: z.string(),
    images: z.array(copilotImageInputSchema).default([]),
    pageName: z.enum(["/purchase", "/order-submit"]).optional(),
  })
  .superRefine((value, context) => {
    const hasText = value.message.trim().length > 0;
    const hasImages = value.images.length > 0;
    if (hasText || hasImages) {
      return;
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "message 与 images 不能同时为空",
    });
  });

export const copilotAutofillRequestSchema = copilotInputRequestSchema;

export const copilotChatRequestSchema = copilotInputRequestSchema;

export const copilotImageExtractLineSchema = z.object({
  line_id: z.string().min(1),
  original_text: z.string().min(1),
  qty_hint: z.number().int().positive().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export const copilotImageExtractSchema = z.object({
  lines: z.array(copilotImageExtractLineSchema).default([]),
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
export type CopilotImageExtractOutput = z.infer<typeof copilotImageExtractSchema>;
