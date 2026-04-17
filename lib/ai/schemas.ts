import { z } from "zod";

export const recommendationItemSchema = z.object({
  sku_id: z.string().min(1),
  suggested_qty: z.number().int().positive(),
  reason: z.string().min(1),
  reason_tags: z.array(z.string()).default([]),
  priority: z.number().int().positive().default(1),
  action_type: z.enum(["add_to_cart", "adjust_qty", "replace_item"]).default("add_to_cart"),
});

export const cartOptimizationDecisionSchema = z.object({
  bar_type: z.enum(["threshold", "box_adjustment", "pairing"]),
  combo_id: z.string().min(1),
  explanation: z.string().min(1),
});

export const cartOptimizationSchema = z.object({
  decisions: z.array(cartOptimizationDecisionSchema).default([]),
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
