import { z } from "zod";

export const recommendationItemSchema = z.object({
  sku_id: z.string().min(1),
  suggested_qty: z.number().int().positive(),
  reason: z.string().min(1),
  reason_tags: z.array(z.string()).default([]),
  priority: z.number().int().positive().default(1),
  action_type: z.enum(["add_to_cart", "adjust_qty", "replace_item"]).default("add_to_cart"),
});

export const thresholdSuggestionSchema = z
  .object({
    sku_id: z.string().min(1),
    suggested_qty: z.number().int().positive(),
    reason: z.string().min(1),
    effect: z.string().min(1),
  })
  .nullable()
  .default(null);

export const boxAdjustmentSchema = z.object({
  sku_id: z.string().min(1),
  from_qty: z.number().int().nonnegative(),
  to_qty: z.number().int().positive(),
  reason: z.string().min(1),
});

export const pairSuggestionSchema = z.object({
  sku_id: z.string().min(1),
  suggested_qty: z.number().int().positive(),
  reason: z.string().min(1),
});

export const cartOptimizationSchema = z.object({
  thresholdSuggestion: thresholdSuggestionSchema,
  boxAdjustments: z.array(boxAdjustmentSchema).default([]),
  pairSuggestions: z.array(pairSuggestionSchema).default([]),
});

export const explanationItemSchema = z.object({
  sku_id: z.string().min(1),
  explanation: z.string().min(1),
});

export const explanationOutputSchema = z.object({
  explanations: z.array(explanationItemSchema).min(1),
});

export type RecommendationItemOutput = z.infer<typeof recommendationItemSchema>;
export type CartOptimizationOutput = z.infer<typeof cartOptimizationSchema>;
export type ExplanationOutput = z.infer<typeof explanationOutputSchema>;
