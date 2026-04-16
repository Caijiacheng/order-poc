import {
  buildCartOptimizationPrompt,
  buildExplanationPrompt,
  buildRecommendationPrompt,
} from "@/lib/ai/prompts";
import {
  generateCartOptimization,
  generateExplanation,
  generateRecommendationItems,
} from "@/lib/ai/service";
import type {
  CartOptimizationOutput,
  ExplanationOutput,
  RecommendationItemOutput,
} from "@/lib/ai/schemas";
import { replaceCartItems, setCartCustomer, buildDeterministicCartInsights } from "@/lib/cart/service";
import { BusinessError } from "@/lib/domain/errors";
import {
  createRecommendationItems,
  createRecommendationRun,
  expireOpenItemsForScene,
  markItemsExplained,
} from "@/lib/domain/recommendation-lifecycle";
import {
  selectDailyRecommendationCandidates,
  selectWeeklyFocusCandidates,
} from "@/lib/domain/recommendation-rules";
import { appendMetricEvent, getMemoryStore, nowIso } from "@/lib/memory/store";
import type {
  DealerEntity,
  ProductEntity,
  SuggestionScene,
} from "@/lib/memory/types";
import { withSpan } from "@/lib/tracing/telemetry";

type NormalizedRecommendationItem = {
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  reason: string;
  reason_tags: string[];
  priority: number;
  action_type: "add_to_cart" | "adjust_qty" | "replace_item";
};

type RecommendationResponseItem = NormalizedRecommendationItem & {
  recommendation_item_id?: string;
};

function findDealer(customerId: string): DealerEntity {
  const store = getMemoryStore();
  const dealer = store.dealers.find((item) => item.customer_id === customerId);
  if (!dealer) {
    throw new BusinessError("NOT_FOUND", "经销商不存在", 404);
  }
  if (dealer.status !== "active") {
    throw new BusinessError("CONFLICT", "经销商已停用", 409);
  }
  return dealer;
}

function findTemplate(customerId: string, scene: SuggestionScene) {
  const store = getMemoryStore();
  return (
    store.suggestionTemplates
      .filter(
        (item) =>
          item.customer_id === customerId && item.scene === scene && item.enabled,
      )
      .sort((left, right) => left.priority - right.priority)[0] ?? undefined
  );
}

function buildFallbackRecommendationItems(
  candidates: ProductEntity[],
): RecommendationItemOutput[] {
  return candidates.slice(0, 3).map((item, index) => ({
    sku_id: item.sku_id,
    suggested_qty: Math.max(1, item.box_multiple),
    reason: `${item.sku_name} 与当前客户画像匹配，建议优先补货。`,
    reason_tags: ["规则候选", "补货建议"],
    priority: index + 1,
    action_type: "add_to_cart",
  }));
}

function normalizeRecommendationItems(input: {
  rawItems: RecommendationItemOutput[];
  candidates: ProductEntity[];
}): NormalizedRecommendationItem[] {
  const candidateMap = new Map(input.candidates.map((item) => [item.sku_id, item]));
  const dedup = new Set<string>();
  const normalized: NormalizedRecommendationItem[] = [];

  for (const raw of input.rawItems) {
    const product = candidateMap.get(raw.sku_id);
    if (!product) continue;
    if (dedup.has(raw.sku_id)) continue;
    dedup.add(raw.sku_id);
    normalized.push({
      sku_id: raw.sku_id,
      sku_name: product.sku_name,
      suggested_qty: Math.max(1, raw.suggested_qty),
      reason: raw.reason,
      reason_tags: raw.reason_tags.slice(0, 6),
      priority: raw.priority,
      action_type: raw.action_type,
    });
  }

  if (normalized.length === 0) {
    return buildFallbackRecommendationItems(input.candidates).map((item) => ({
      ...item,
      sku_name: candidateMap.get(item.sku_id)?.sku_name ?? item.sku_id,
    }));
  }

  return normalized.sort((left, right) => left.priority - right.priority);
}

function attachRecommendationItemIds(input: {
  items: NormalizedRecommendationItem[];
  records: Array<{
    recommendation_item_id: string;
    sku_id: string;
    suggested_qty: number;
    action_type: "add_to_cart" | "adjust_qty" | "replace_item";
  }>;
}): RecommendationResponseItem[] {
  const idBuckets = new Map<string, string[]>();
  for (const record of input.records) {
    const key = `${record.sku_id}|${record.suggested_qty}|${record.action_type}`;
    const existing = idBuckets.get(key) ?? [];
    existing.push(record.recommendation_item_id);
    idBuckets.set(key, existing);
  }

  return input.items.map((item) => {
    const key = `${item.sku_id}|${item.suggested_qty}|${item.action_type}`;
    const nextIds = idBuckets.get(key) ?? [];
    const recommendationItemId = nextIds.shift();
    idBuckets.set(key, nextIds);
    return {
      ...item,
      recommendation_item_id: recommendationItemId,
    };
  });
}

function updateModelMetrics(input: {
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
}) {
  const metrics = getMemoryStore().metrics;
  metrics.totalModelCalls += 1;
  metrics.totalInputTokens += input.input_tokens ?? 0;
  metrics.totalOutputTokens += input.output_tokens ?? 0;
  metrics.averageModelLatencyMs = Math.round(
    ((metrics.averageModelLatencyMs * (metrics.totalModelCalls - 1) +
      input.model_latency_ms) /
      metrics.totalModelCalls) *
      100,
  ) / 100;
}

export async function generateRecommendationsForCustomer(input: {
  session_id: string;
  customer_id: string;
  trigger_source?: "auto" | "manual" | "assistant";
  page_name?: "/procurement" | "/catalog" | "/basket";
}) {
  const triggerSource = input.trigger_source ?? "manual";
  const pageName = input.page_name ?? "/procurement";
  const store = getMemoryStore();

  return withSpan(
    "homepage.generate-recommendations",
    {
      "customer.id": input.customer_id,
      "session.id": input.session_id,
    },
    async (traceId) => {
      const dealer = findDealer(input.customer_id);
      setCartCustomer(input.session_id, dealer.customer_id);

      const dailyCandidates = selectDailyRecommendationCandidates({
        products: store.products,
        dealer,
        rules: store.rules,
      });
      const weeklyCandidates = selectWeeklyFocusCandidates({
        products: store.products,
        campaigns: store.campaigns,
        dealer,
        rules: store.rules,
      });

      expireOpenItemsForScene({
        customer_id: dealer.customer_id,
        scene: "daily_recommendation",
      });
      expireOpenItemsForScene({
        customer_id: dealer.customer_id,
        scene: "weekly_focus",
      });

      const dailyTemplate = findTemplate(dealer.customer_id, "daily_recommendation");
      const weeklyTemplate = findTemplate(dealer.customer_id, "weekly_focus");

      const dailyPrompt = buildRecommendationPrompt({
        scene: "daily_recommendation",
        dealer,
        rules: store.rules,
        campaigns: store.campaigns,
        candidates: dailyCandidates,
        promptConfig: store.promptConfig,
        template: dailyTemplate,
      });
      const weeklyPrompt = buildRecommendationPrompt({
        scene: "weekly_focus",
        dealer,
        rules: store.rules,
        campaigns: store.campaigns,
        candidates: weeklyCandidates,
        promptConfig: store.promptConfig,
        template: weeklyTemplate,
      });

      const [dailyAi, weeklyAi] = await Promise.all([
        generateRecommendationItems({
          prompt: dailyPrompt,
          fallbackItems: buildFallbackRecommendationItems(dailyCandidates),
          functionId: "ai.generate-daily-recommendation",
          telemetryMetadata: {
            trace_id: traceId,
            customer_id: dealer.customer_id,
            scene: "daily_recommendation",
            session_id: input.session_id,
          },
        }),
        generateRecommendationItems({
          prompt: weeklyPrompt,
          fallbackItems: buildFallbackRecommendationItems(weeklyCandidates),
          functionId: "ai.generate-weekly-focus-recommendation",
          telemetryMetadata: {
            trace_id: traceId,
            customer_id: dealer.customer_id,
            scene: "weekly_focus",
            session_id: input.session_id,
          },
        }),
      ]);

      updateModelMetrics(dailyAi.meta);
      updateModelMetrics(weeklyAi.meta);

      const dailyItems = normalizeRecommendationItems({
        rawItems: dailyAi.items,
        candidates: dailyCandidates,
      });
      const weeklyItems = normalizeRecommendationItems({
        rawItems: weeklyAi.items,
        candidates: weeklyCandidates,
      });

      const dailyRun = createRecommendationRun({
        session_id: input.session_id,
        trace_id: traceId,
        function_id: "ai.generate-daily-recommendation",
        telemetry_metadata: {
          scene: "daily_recommendation",
          generated_at: nowIso(),
        },
        customer_id: dealer.customer_id,
        customer_name: dealer.customer_name,
        scene: "daily_recommendation",
        page_name: pageName,
        trigger_source: triggerSource,
        template_id: dailyTemplate?.template_id,
        template_name: dailyTemplate?.template_name,
        prompt_version: "runtime",
        prompt_snapshot: dailyPrompt,
        candidate_sku_ids: dailyCandidates.map((item) => item.sku_id),
        returned_sku_ids: dailyItems.map((item) => item.sku_id),
        model_name: dailyAi.meta.model_name,
        model_latency_ms: dailyAi.meta.model_latency_ms,
        input_tokens: dailyAi.meta.input_tokens,
        output_tokens: dailyAi.meta.output_tokens,
      });
      const dailyRecords = createRecommendationItems(
        dailyRun,
        dailyItems.map((item, index) => ({
          ...item,
          suggested_rank: index + 1,
          effect_type: "replenishment",
        })),
      );

      const weeklyRun = createRecommendationRun({
        session_id: input.session_id,
        trace_id: traceId,
        function_id: "ai.generate-weekly-focus-recommendation",
        telemetry_metadata: {
          scene: "weekly_focus",
          generated_at: nowIso(),
        },
        customer_id: dealer.customer_id,
        customer_name: dealer.customer_name,
        scene: "weekly_focus",
        page_name: pageName,
        trigger_source: triggerSource,
        template_id: weeklyTemplate?.template_id,
        template_name: weeklyTemplate?.template_name,
        prompt_version: "runtime",
        prompt_snapshot: weeklyPrompt,
        candidate_sku_ids: weeklyCandidates.map((item) => item.sku_id),
        returned_sku_ids: weeklyItems.map((item) => item.sku_id),
        model_name: weeklyAi.meta.model_name,
        model_latency_ms: weeklyAi.meta.model_latency_ms,
        input_tokens: weeklyAi.meta.input_tokens,
        output_tokens: weeklyAi.meta.output_tokens,
      });
      const weeklyRecords = createRecommendationItems(
        weeklyRun,
        weeklyItems.map((item, index) => ({
          ...item,
          suggested_rank: index + 1,
          effect_type: "weekly_focus",
        })),
      );

      store.metrics.recommendationRequests += 1;
      store.metrics.weeklyFocusRequests += 1;
      store.metrics.customerSceneBreakdown[
        `${dealer.customer_id}_daily_recommendation`
      ] = (store.metrics.customerSceneBreakdown[
        `${dealer.customer_id}_daily_recommendation`
      ] ?? 0) + 1;
      store.metrics.customerSceneBreakdown[`${dealer.customer_id}_weekly_focus`] =
        (store.metrics.customerSceneBreakdown[`${dealer.customer_id}_weekly_focus`] ?? 0) + 1;

      const dailyRecommendations = attachRecommendationItemIds({
        items: dailyItems,
        records: dailyRecords,
      });
      const weeklyFocusRecommendations = attachRecommendationItemIds({
        items: weeklyItems,
        records: weeklyRecords,
      });

      return {
        dailyRecommendations,
        weeklyFocusRecommendations,
        summary: {
          trace_id: traceId,
          daily_run_id: dailyRun.recommendation_run_id,
          weekly_run_id: weeklyRun.recommendation_run_id,
        },
      };
    },
  );
}

export async function generateCartOptimizationForSession(input: {
  session_id: string;
  customer_id?: string;
  cart_items?: Array<{ sku_id: string; qty: number }>;
}) {
  const store = getMemoryStore();

  return withSpan(
    "cart.generate-optimization",
    {
      "session.id": input.session_id,
      "customer.id": input.customer_id ?? "unknown",
    },
    async (traceId) => {
      if (input.cart_items) {
        replaceCartItems(input.session_id, input.cart_items);
      }

      if (input.customer_id) {
        setCartCustomer(input.session_id, input.customer_id);
      }

      const { session, dealer, thresholdCandidates, boxAdjustments, pairSuggestions } =
        buildDeterministicCartInsights(input.session_id, input.customer_id);

      const template = findTemplate(dealer.customer_id, "box_pair_optimization");
      const prompt = buildCartOptimizationPrompt({
        dealer,
        rules: store.rules,
        promptConfig: store.promptConfig,
        cartSummary: {
          total_amount: session.summary.total_amount,
          threshold_amount: session.summary.threshold_amount,
          gap_to_threshold: session.summary.gap_to_threshold,
        },
        thresholdCandidates: thresholdCandidates.map((item) => ({
          sku_id: item.sku_id,
          suggested_qty: item.suggested_qty,
          reason: item.reason,
        })),
        boxAdjustments,
        pairSuggestions: pairSuggestions.map((item) => ({
          sku_id: item.sku_id,
          suggested_qty: item.suggested_qty,
          reason: item.reason,
        })),
        template,
      });

      const fallbackOutput: CartOptimizationOutput = {
        thresholdSuggestion:
          thresholdCandidates.length > 0
            ? {
                sku_id: thresholdCandidates[0].sku_id,
                suggested_qty: thresholdCandidates[0].suggested_qty,
                reason: thresholdCandidates[0].reason,
                effect: thresholdCandidates[0].effect,
              }
            : null,
        boxAdjustments,
        pairSuggestions: pairSuggestions.map((item) => ({
          sku_id: item.sku_id,
          suggested_qty: item.suggested_qty,
          reason: item.reason,
        })),
      };

      const aiResult = await generateCartOptimization({
        prompt,
        fallbackOutput,
        functionId: "ai.generate-cart-optimization",
        telemetryMetadata: {
          trace_id: traceId,
          customer_id: dealer.customer_id,
          scene: "box_pair_optimization",
          session_id: input.session_id,
        },
      });
      updateModelMetrics(aiResult.meta);

      const validSkuIds = new Set(store.products.map((item) => item.sku_id));
      const thresholdSuggestion =
        aiResult.output.thresholdSuggestion &&
        validSkuIds.has(aiResult.output.thresholdSuggestion.sku_id)
          ? aiResult.output.thresholdSuggestion
          : fallbackOutput.thresholdSuggestion;
      const normalizedBoxAdjustments = aiResult.output.boxAdjustments
        .filter((item) => validSkuIds.has(item.sku_id))
        .slice(0, 10);
      const normalizedPairSuggestions = aiResult.output.pairSuggestions
        .filter((item) => validSkuIds.has(item.sku_id))
        .slice(0, 10);

      const returnedSkuIds = [
        ...(thresholdSuggestion ? [thresholdSuggestion.sku_id] : []),
        ...normalizedBoxAdjustments.map((item) => item.sku_id),
        ...normalizedPairSuggestions.map((item) => item.sku_id),
      ];
      const candidateSkuIds = [
        ...thresholdCandidates.map((item) => item.sku_id),
        ...boxAdjustments.map((item) => item.sku_id),
        ...pairSuggestions.map((item) => item.sku_id),
      ];

      const run = createRecommendationRun({
        session_id: input.session_id,
        trace_id: traceId,
        function_id: "ai.generate-cart-optimization",
        telemetry_metadata: {
          scene: "box_pair_optimization",
          generated_at: nowIso(),
        },
        customer_id: dealer.customer_id,
        customer_name: dealer.customer_name,
        scene: "box_pair_optimization",
        page_name: "/basket",
        trigger_source: "assistant",
        template_id: template?.template_id,
        template_name: template?.template_name,
        prompt_version: "runtime",
        prompt_snapshot: prompt,
        candidate_sku_ids: candidateSkuIds,
        returned_sku_ids: returnedSkuIds,
        cart_amount_before: session.summary.total_amount,
        cart_amount_after: session.summary.total_amount,
        model_name: aiResult.meta.model_name,
        model_latency_ms: aiResult.meta.model_latency_ms,
        input_tokens: aiResult.meta.input_tokens,
        output_tokens: aiResult.meta.output_tokens,
      });

      const skuToName = new Map(store.products.map((item) => [item.sku_id, item.sku_name]));
      const runItems: Array<{
        sku_id: string;
        sku_name: string;
        suggested_qty: number;
        suggested_rank: number;
        reason: string;
        reason_tags: string[];
        action_type: "add_to_cart" | "adjust_qty" | "replace_item";
        effect_type:
          | "replenishment"
          | "weekly_focus"
          | "threshold_reached"
          | "box_adjustment"
          | "pair_item";
      }> = [];

      if (thresholdSuggestion) {
        runItems.push({
          sku_id: thresholdSuggestion.sku_id,
          sku_name: skuToName.get(thresholdSuggestion.sku_id) ?? thresholdSuggestion.sku_id,
          suggested_qty: thresholdSuggestion.suggested_qty,
          suggested_rank: 1,
          reason: thresholdSuggestion.reason,
          reason_tags: ["threshold_topup"],
          action_type: "add_to_cart",
          effect_type: "threshold_reached",
        });
      }
      normalizedBoxAdjustments.forEach((item, index) => {
        runItems.push({
          sku_id: item.sku_id,
          sku_name: skuToName.get(item.sku_id) ?? item.sku_id,
          suggested_qty: item.to_qty,
          suggested_rank: runItems.length + index + 1,
          reason: item.reason,
          reason_tags: ["box_adjustment"],
          action_type: "adjust_qty",
          effect_type: "box_adjustment",
        });
      });
      normalizedPairSuggestions.forEach((item, index) => {
        runItems.push({
          sku_id: item.sku_id,
          sku_name: skuToName.get(item.sku_id) ?? item.sku_id,
          suggested_qty: item.suggested_qty,
          suggested_rank: runItems.length + index + 1,
          reason: item.reason,
          reason_tags: ["pair_item"],
          action_type: "add_to_cart",
          effect_type: "pair_item",
        });
      });
      const createdRunItems = createRecommendationItems(run, runItems);
      const recommendationItemIdBySkuAndEffect = new Map<string, string>();
      for (const item of createdRunItems) {
        if (!item.effect_type) {
          continue;
        }
        recommendationItemIdBySkuAndEffect.set(
          `${item.sku_id}|${item.effect_type}`,
          item.recommendation_item_id,
        );
      }

      store.metrics.cartOptimizationRequests += 1;
      appendMetricEvent({
        customerId: dealer.customer_id,
        customerName: dealer.customer_name,
        eventType: "cart_optimized",
        scene: "box_pair_optimization",
        payload: {
          recommendation_run_id: run.recommendation_run_id,
          returned_sku_ids: returnedSkuIds,
        },
      });

      const thresholdSuggestionWithId = thresholdSuggestion
        ? {
            ...thresholdSuggestion,
            recommendation_item_id: recommendationItemIdBySkuAndEffect.get(
              `${thresholdSuggestion.sku_id}|threshold_reached`,
            ),
          }
        : null;
      const boxAdjustmentsWithId = normalizedBoxAdjustments.map((item) => ({
        ...item,
        recommendation_item_id: recommendationItemIdBySkuAndEffect.get(
          `${item.sku_id}|box_adjustment`,
        ),
      }));
      const pairSuggestionsWithId = normalizedPairSuggestions.map((item) => ({
        ...item,
        recommendation_item_id: recommendationItemIdBySkuAndEffect.get(
          `${item.sku_id}|pair_item`,
        ),
      }));

      return {
        thresholdSuggestion: thresholdSuggestionWithId,
        boxAdjustments: boxAdjustmentsWithId,
        pairSuggestions: pairSuggestionsWithId,
        summary: {
          trace_id: traceId,
          recommendation_run_id: run.recommendation_run_id,
          cart: session.summary,
        },
      };
    },
  );
}

export async function generateExplanationForItems(input: {
  session_id: string;
  customer_id: string;
  scene: SuggestionScene;
  target_sku_ids: string[];
}) {
  const store = getMemoryStore();

  return withSpan(
    "recommendation.explain",
    {
      "session.id": input.session_id,
      "customer.id": input.customer_id,
      scene: input.scene,
    },
    async (traceId) => {
      const dealer = findDealer(input.customer_id);
      const updatedItems = markItemsExplained({
        customer_id: input.customer_id,
        scene: input.scene,
        target_sku_ids: input.target_sku_ids,
      });

      if (updatedItems.length === 0) {
        throw new BusinessError("NOT_FOUND", "未找到可解释的推荐项", 404);
      }

      const template = findTemplate(input.customer_id, input.scene);
      const prompt = buildExplanationPrompt({
        dealer,
        scene: input.scene,
        promptConfig: store.promptConfig,
        targetItems: updatedItems.map((item) => ({
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          suggested_qty: item.suggested_qty,
          reason: item.reason,
          reason_tags: item.reason_tags,
        })),
        template,
      });

      const fallback: ExplanationOutput = {
        explanations: updatedItems.map((item) => ({
          sku_id: item.sku_id,
          explanation: `${item.sku_name}：${item.reason}`,
        })),
      };

      const aiResult = await generateExplanation({
        prompt,
        fallbackOutput: fallback,
        functionId: "recommendation.explain",
        telemetryMetadata: {
          trace_id: traceId,
          customer_id: dealer.customer_id,
          scene: input.scene,
          session_id: input.session_id,
        },
      });
      updateModelMetrics(aiResult.meta);

      store.metrics.explanationRequests += 1;
      appendMetricEvent({
        customerId: dealer.customer_id,
        customerName: dealer.customer_name,
        eventType: "explanation_viewed",
        scene: input.scene,
        payload: {
          target_sku_ids: input.target_sku_ids,
        },
      });

      const explanations = aiResult.output.explanations;
      const skuNameMap = new Map(updatedItems.map((item) => [item.sku_id, item.sku_name]));
      const title =
        explanations.length <= 1
          ? `${skuNameMap.get(explanations[0]?.sku_id ?? "") ?? "推荐项"}推荐说明`
          : `推荐说明（${explanations.length}项）`;
      const content =
        explanations.length <= 1
          ? (explanations[0]?.explanation ?? "暂无说明")
          : explanations
              .map((item, index) => `${index + 1}. ${item.explanation}`)
              .join("\n");

      return {
        title,
        content,
        explanations,
        summary: {
          trace_id: traceId,
          scene: input.scene,
          count: explanations.length,
        },
      };
    },
  );
}
