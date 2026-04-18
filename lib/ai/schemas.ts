import { z } from "zod";

export const recommendationItemSchema = z.object({
  sku_id: z.string().min(1),
  suggested_qty: z.number().int().positive(),
  reason: z.string().min(1),
  reason_tags: z.array(z.string()),
  priority: z.number().int().positive(),
  action_type: z.enum(["add_to_cart", "adjust_qty", "replace_item"]),
});

export const recommendationItemsOutputSchema = z.object({
  elements: z.array(recommendationItemSchema),
});

export const cartOptimizationDecisionSchema = z.object({
  bar_type: z.enum(["threshold", "box_adjustment", "pairing"]),
  combo_id: z.string().min(1),
  explanation: z.string().min(1),
});

export const cartOptimizationSchema = z.object({
  decisions: z.array(cartOptimizationDecisionSchema),
});

export const explanationItemSchema = z.object({
  sku_id: z.string().min(1),
  explanation: z.string().min(1),
});

export const explanationOutputSchema = z.object({
  explanations: z.array(explanationItemSchema).min(1),
});

export type RecommendationItemOutput = z.infer<typeof recommendationItemSchema>;
export type RecommendationItemsOutput = z.infer<typeof recommendationItemsOutputSchema>;
export type CartOptimizationOutput = z.infer<typeof cartOptimizationSchema>;
export type ExplanationOutput = z.infer<typeof explanationOutputSchema>;
