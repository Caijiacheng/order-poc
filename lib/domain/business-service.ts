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
  CartOptimizationBarType,
  CartOptimizationRecommendationBar,
  DealerEntity,
  FrontstagePageName,
  ProductEntity,
  RecommendationStrategyEntity,
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

function strategyMatchesDealer(input: {
  strategy: RecommendationStrategyEntity;
  dealer: DealerEntity;
}) {
  const { strategy, dealer } = input;
  const store = getMemoryStore();
  if (strategy.target_dealer_ids.includes(dealer.customer_id)) {
    return true;
  }

  if (strategy.dealer_segment_ids.length === 0) {
    return false;
  }

  return store.dealerSegments.some(
    (segment) =>
      strategy.dealer_segment_ids.includes(segment.segment_id) &&
      segment.status === "active" &&
      (segment.dealer_ids.includes(dealer.customer_id) ||
        segment.customer_types.includes(dealer.customer_type) ||
        segment.channel_types.includes(dealer.channel_type) ||
        segment.city_list.includes(dealer.city)),
  );
}

function strategySupportsScene(input: {
  strategyScene: RecommendationStrategyEntity["scene"];
  runtimeScene: SuggestionScene;
}) {
  const { strategyScene, runtimeScene } = input;
  if (runtimeScene === "daily_recommendation") {
    return (
      strategyScene === "replenishment_bundle" || strategyScene === "hot_sale_bundle"
    );
  }
  if (runtimeScene === "weekly_focus") {
    return strategyScene === "campaign_bundle";
  }
  return false;
}

function strategySceneRankForRuntime(input: {
  strategyScene: RecommendationStrategyEntity["scene"];
  runtimeScene: SuggestionScene;
}) {
  const { strategyScene, runtimeScene } = input;
  if (runtimeScene === "daily_recommendation") {
    if (strategyScene === "replenishment_bundle") return 0;
    if (strategyScene === "hot_sale_bundle") return 1;
    return 9;
  }
  if (runtimeScene === "weekly_focus") {
    return strategyScene === "campaign_bundle" ? 0 : 9;
  }
  return 9;
}

function findStrategy(dealer: DealerEntity, scene: SuggestionScene) {
  const store = getMemoryStore();
  const strategy =
    store.recommendationStrategies
      .filter(
        (item) =>
          strategySupportsScene({ strategyScene: item.scene, runtimeScene: scene }) &&
          item.status === "active" &&
          strategyMatchesDealer({ strategy: item, dealer }),
      )
      .sort((left, right) => {
        const leftRank = strategySceneRankForRuntime({
          strategyScene: left.scene,
          runtimeScene: scene,
        });
        const rightRank = strategySceneRankForRuntime({
          strategyScene: right.scene,
          runtimeScene: scene,
        });
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return left.priority - right.priority;
      })[0] ?? undefined;

  if (!strategy) {
    return undefined;
  }

  const expression = store.expressionTemplates.find(
    (item) =>
      item.expression_template_id === strategy.expression_template_id &&
      item.status === "active",
  );

  return {
    ...strategy,
    style_hint: expression?.style_hint ?? "沿用表达模板",
  };
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

type DeterministicComboItem = {
  sku_id: string;
  sku_name: string;
  action_type: "add_to_cart" | "adjust_qty";
  suggested_qty: number;
  from_qty?: number;
  to_qty?: number;
  reason: string;
  line_amount: number;
};

type DeterministicCombo = {
  bar_type: CartOptimizationBarType;
  combo_id: string;
  headline: string;
  value_message: string;
  action_label: string;
  items: DeterministicComboItem[];
  deterministic_explanation: string;
  score: number;
};

function formatCny(amount: number) {
  return `¥${Math.max(0, Math.round(amount))}`;
}

function sortCombosByScore(combos: DeterministicCombo[]) {
  return [...combos].sort((left, right) => right.score - left.score);
}

function dedupeSkuIds(items: string[]) {
  return Array.from(new Set(items));
}

const CART_BAR_ORDER: CartOptimizationBarType[] = [
  "threshold",
  "box_adjustment",
  "pairing",
];

function buildComboItemKey(input: {
  bar_type: CartOptimizationBarType;
  combo_id: string;
  item: DeterministicComboItem;
}) {
  return [
    input.bar_type,
    input.combo_id,
    input.item.sku_id,
    input.item.action_type,
    input.item.suggested_qty,
    input.item.from_qty ?? "",
    input.item.to_qty ?? "",
  ].join("|");
}

function toEffectType(barType: CartOptimizationBarType) {
  if (barType === "threshold") {
    return "threshold_reached" as const;
  }
  if (barType === "box_adjustment") {
    return "box_adjustment" as const;
  }
  return "pair_item" as const;
}

function buildThresholdCombos(input: {
  candidates: Array<{
    sku_id: string;
    sku_name: string;
    suggested_qty: number;
    reason: string;
    effect: string;
  }>;
  productMap: Map<string, ProductEntity>;
  gap: number;
  dealer: DealerEntity;
}) {
  const combos: DeterministicCombo[] = [];
  for (const [index, candidate] of input.candidates.slice(0, 3).entries()) {
    const product = input.productMap.get(candidate.sku_id);
    if (!product) {
      continue;
    }
    const lineAmount = product.price_per_case * candidate.suggested_qty;
    const distance = Math.abs(input.gap - lineAmount);
    const overshoot = Math.max(0, lineAmount - input.gap);
    const frequentBoost = input.dealer.frequent_items.includes(candidate.sku_id) ? 80 : 0;
    const score = 1200 - distance - overshoot * 0.1 + frequentBoost;
    combos.push({
      bar_type: "threshold",
      combo_id: `threshold_combo_${index + 1}`,
      headline: `门槛补差推荐：${candidate.sku_name}`,
      value_message: `预计补入 ${formatCny(lineAmount)}，快速贴近门槛差额 ${formatCny(
        input.gap,
      )}。`,
      action_label: "一键加入",
      items: [
        {
          sku_id: candidate.sku_id,
          sku_name: candidate.sku_name,
          action_type: "add_to_cart",
          suggested_qty: candidate.suggested_qty,
          reason: candidate.reason,
          line_amount: lineAmount,
        },
      ],
      deterministic_explanation: candidate.reason || candidate.effect,
      score,
    });
  }
  return sortCombosByScore(combos);
}

function buildBoxAdjustmentCombos(input: {
  adjustments: Array<{ sku_id: string; from_qty: number; to_qty: number; reason: string }>;
  productMap: Map<string, ProductEntity>;
}) {
  const combos: DeterministicCombo[] = [];
  const usable = input.adjustments
    .map((item) => {
      const product = input.productMap.get(item.sku_id);
      if (!product) {
        return null;
      }
      return {
        ...item,
        sku_name: product.sku_name,
        line_amount: product.price_per_case * Math.max(0, item.to_qty - item.from_qty),
      };
    })
    .filter(
      (
        item,
      ): item is {
        sku_id: string;
        from_qty: number;
        to_qty: number;
        reason: string;
        sku_name: string;
        line_amount: number;
      } => Boolean(item),
    );

  for (const [index, item] of usable.slice(0, 3).entries()) {
    const delta = Math.max(0, item.to_qty - item.from_qty);
    combos.push({
      bar_type: "box_adjustment",
      combo_id: `box_combo_single_${index + 1}`,
      headline: `箱规修正：${item.sku_name}`,
      value_message: `将 ${item.sku_id} 从 ${item.from_qty} 调整到 ${item.to_qty}，减少非整箱出货。`,
      action_label: "一键调整",
      items: [
        {
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          action_type: "adjust_qty",
          suggested_qty: item.to_qty,
          from_qty: item.from_qty,
          to_qty: item.to_qty,
          reason: item.reason,
          line_amount: item.line_amount,
        },
      ],
      deterministic_explanation: item.reason,
      score: 500 + delta * 20 + item.line_amount * 0.02,
    });
  }

  if (usable.length > 1) {
    const allItems = usable.slice(0, 4);
    const totalDelta = allItems.reduce(
      (sum, item) => sum + Math.max(0, item.to_qty - item.from_qty),
      0,
    );
    combos.push({
      bar_type: "box_adjustment",
      combo_id: "box_combo_bundle_all",
      headline: `箱规集中修正（${allItems.length} 项）`,
      value_message: `一次调整 ${allItems.length} 个 SKU，合计补齐 ${totalDelta} 件到整箱倍数。`,
      action_label: "一键调整",
      items: allItems.map((item) => ({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        action_type: "adjust_qty",
        suggested_qty: item.to_qty,
        from_qty: item.from_qty,
        to_qty: item.to_qty,
        reason: item.reason,
        line_amount: item.line_amount,
      })),
      deterministic_explanation: "组合修正可减少多 SKU 的非整箱数量，降低配送复杂度。",
      score:
        650 +
        totalDelta * 16 +
        allItems.reduce((sum, item) => sum + item.line_amount, 0) * 0.01,
    });
  }

  return sortCombosByScore(combos);
}

function buildPairingCombos(input: {
  suggestions: Array<{ sku_id: string; sku_name: string; suggested_qty: number; reason: string }>;
  productMap: Map<string, ProductEntity>;
  dealer: DealerEntity;
}) {
  const combos: DeterministicCombo[] = [];
  const usable = input.suggestions
    .map((item) => {
      const product = input.productMap.get(item.sku_id);
      if (!product) {
        return null;
      }
      return {
        ...item,
        line_amount: product.price_per_case * item.suggested_qty,
      };
    })
    .filter(
      (
        item,
      ): item is {
        sku_id: string;
        sku_name: string;
        suggested_qty: number;
        reason: string;
        line_amount: number;
      } => Boolean(item),
    );

  for (const [index, item] of usable.slice(0, 3).entries()) {
    const frequentBoost = input.dealer.frequent_items.includes(item.sku_id) ? 40 : 0;
    combos.push({
      bar_type: "pairing",
      combo_id: `pair_combo_single_${index + 1}`,
      headline: `搭配补充：${item.sku_name}`,
      value_message: `预计新增 ${formatCny(item.line_amount)}，补齐常见搭配采购链路。`,
      action_label: "一键加入",
      items: [
        {
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          action_type: "add_to_cart",
          suggested_qty: item.suggested_qty,
          reason: item.reason,
          line_amount: item.line_amount,
        },
      ],
      deterministic_explanation: item.reason,
      score: 420 + item.line_amount * 0.03 + frequentBoost,
    });
  }

  if (usable.length >= 2) {
    const bundle = usable.slice(0, 2);
    const amount = bundle.reduce((sum, item) => sum + item.line_amount, 0);
    combos.push({
      bar_type: "pairing",
      combo_id: "pair_combo_bundle_2",
      headline: "搭配补充组合（2 项）",
      value_message: `组合补充 ${bundle.length} 个搭配 SKU，预计新增 ${formatCny(amount)}。`,
      action_label: "一键加入",
      items: bundle.map((item) => ({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        action_type: "add_to_cart",
        suggested_qty: item.suggested_qty,
        reason: item.reason,
        line_amount: item.line_amount,
      })),
      deterministic_explanation: "组合补充能更快形成完整搭配结构，减少漏补。",
      score: 470 + amount * 0.025 + bundle.length * 20,
    });
  }

  return sortCombosByScore(combos);
}

export async function generateRecommendationsForCustomer(input: {
  session_id: string;
  customer_id: string;
  trigger_source?: "auto" | "manual" | "assistant";
  page_name?: FrontstagePageName;
}) {
  const triggerSource = input.trigger_source ?? "manual";
  const pageName = input.page_name ?? "/purchase";
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

      const dailyStrategy = findStrategy(dealer, "daily_recommendation");
      const weeklyStrategy = findStrategy(dealer, "weekly_focus");

      const dailyPrompt = buildRecommendationPrompt({
        scene: "daily_recommendation",
        dealer,
        rules: store.rules,
        campaigns: store.campaigns,
        candidates: dailyCandidates,
        promptConfig: store.promptConfig,
        strategy: dailyStrategy,
      });
      const weeklyPrompt = buildRecommendationPrompt({
        scene: "weekly_focus",
        dealer,
        rules: store.rules,
        campaigns: store.campaigns,
        candidates: weeklyCandidates,
        promptConfig: store.promptConfig,
        strategy: weeklyStrategy,
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
        strategy_id: dailyStrategy?.strategy_id,
        expression_template_id: dailyStrategy?.expression_template_id,
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
        strategy_id: weeklyStrategy?.strategy_id,
        expression_template_id: weeklyStrategy?.expression_template_id,
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
      const productMap = new Map(store.products.map((item) => [item.sku_id, item]));

      const thresholdCombos = buildThresholdCombos({
        candidates: thresholdCandidates,
        productMap,
        gap: session.summary.gap_to_threshold,
        dealer,
      }).slice(0, 3);
      const boxAdjustmentCombos = buildBoxAdjustmentCombos({
        adjustments: boxAdjustments,
        productMap,
      }).slice(0, 3);
      const pairingCombos = buildPairingCombos({
        suggestions: pairSuggestions,
        productMap,
        dealer,
      }).slice(0, 3);
      const combosByType: Record<CartOptimizationBarType, DeterministicCombo[]> = {
        threshold: thresholdCombos,
        box_adjustment: boxAdjustmentCombos,
        pairing: pairingCombos,
      };

      const strategy = findStrategy(dealer, "box_pair_optimization");
      const prompt = buildCartOptimizationPrompt({
        dealer,
        rules: store.rules,
        promptConfig: store.promptConfig,
        cartSummary: {
          total_amount: session.summary.total_amount,
          threshold_amount: session.summary.threshold_amount,
          gap_to_threshold: session.summary.gap_to_threshold,
        },
        thresholdCombos: thresholdCombos.map((combo) => ({
          combo_id: combo.combo_id,
          headline: combo.headline,
          value_message: combo.value_message,
          deterministic_score: Math.round(combo.score * 100) / 100,
          items: combo.items.map((item) => ({
            sku_id: item.sku_id,
            suggested_qty: item.suggested_qty,
          })),
        })),
        boxAdjustmentCombos: boxAdjustmentCombos.map((combo) => ({
          combo_id: combo.combo_id,
          headline: combo.headline,
          value_message: combo.value_message,
          deterministic_score: Math.round(combo.score * 100) / 100,
          items: combo.items.map((item) => ({
            sku_id: item.sku_id,
            from_qty: item.from_qty ?? 0,
            to_qty: item.to_qty ?? item.suggested_qty,
          })),
        })),
        pairingCombos: pairingCombos.map((combo) => ({
          combo_id: combo.combo_id,
          headline: combo.headline,
          value_message: combo.value_message,
          deterministic_score: Math.round(combo.score * 100) / 100,
          items: combo.items.map((item) => ({
            sku_id: item.sku_id,
            suggested_qty: item.suggested_qty,
          })),
        })),
        strategy,
      });

      const fallbackOutput: CartOptimizationOutput = {
        decisions: CART_BAR_ORDER.flatMap((barType) => {
          const firstCombo = combosByType[barType][0];
          if (!firstCombo) {
            return [];
          }
          return {
            bar_type: barType,
            combo_id: firstCombo.combo_id,
            explanation: firstCombo.deterministic_explanation,
          };
        }),
      };

      let selectedOutput = fallbackOutput;
      let modelMeta: {
        model_name: string;
        model_latency_ms: number;
        input_tokens?: number;
        output_tokens?: number;
      } = {
        model_name: "deterministic-fallback",
        model_latency_ms: 0,
      };

      try {
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
        selectedOutput = aiResult.output;
        modelMeta = aiResult.meta;
        updateModelMetrics(aiResult.meta);
      } catch {
        selectedOutput = fallbackOutput;
      }

      const decisionByType = new Map<
        CartOptimizationBarType,
        {
          combo_id: string;
          explanation: string;
        }
      >();
      for (const decision of selectedOutput.decisions) {
        if (decisionByType.has(decision.bar_type)) {
          continue;
        }
        decisionByType.set(decision.bar_type, {
          combo_id: decision.combo_id,
          explanation: decision.explanation,
        });
      }

      const selectedBars = CART_BAR_ORDER.flatMap((barType) => {
        const candidates = combosByType[barType];
        if (candidates.length === 0) {
          return [];
        }

        const decision = decisionByType.get(barType);
        const selectedCombo =
          candidates.find((item) => item.combo_id === decision?.combo_id) ?? candidates[0];
        const explanation =
          decision?.explanation?.trim() || selectedCombo.deterministic_explanation;

        return {
          bar_type: barType,
          combo: selectedCombo,
          explanation,
        };
      }).slice(0, 3);

      const candidateSkuIds = dedupeSkuIds(
        Object.values(combosByType).flatMap((combos) =>
          combos.flatMap((combo) => combo.items.map((item) => item.sku_id)),
        ),
      );
      const returnedSkuIds = dedupeSkuIds(
        selectedBars.flatMap((bar) => bar.combo.items.map((item) => item.sku_id)),
      );

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
        page_name: "/order-submit",
        trigger_source: "assistant",
        strategy_id: strategy?.strategy_id,
        expression_template_id: strategy?.expression_template_id,
        prompt_version: "runtime",
        prompt_snapshot: prompt,
        candidate_sku_ids: candidateSkuIds,
        returned_sku_ids: returnedSkuIds,
        cart_amount_before: session.summary.total_amount,
        cart_amount_after: session.summary.total_amount,
        model_name: modelMeta.model_name,
        model_latency_ms: modelMeta.model_latency_ms,
        input_tokens: modelMeta.input_tokens,
        output_tokens: modelMeta.output_tokens,
      });

      const runItems: Array<{
        item_key: string;
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
      selectedBars.forEach((bar) => {
        bar.combo.items.forEach((item) => {
          runItems.push({
            item_key: buildComboItemKey({
              bar_type: bar.bar_type,
              combo_id: bar.combo.combo_id,
              item,
            }),
            sku_id: item.sku_id,
            sku_name: item.sku_name,
            suggested_qty:
              item.action_type === "adjust_qty"
                ? item.to_qty ?? item.suggested_qty
                : item.suggested_qty,
            suggested_rank: runItems.length + 1,
            reason: bar.explanation || item.reason,
            reason_tags: [bar.bar_type],
            action_type: item.action_type,
            effect_type: toEffectType(bar.bar_type),
          });
        });
      });

      const createdRunItems = createRecommendationItems(
        run,
        runItems.map(({ item_key: _itemKey, ...item }) => item),
      );
      const recommendationItemIdByKey = new Map<string, string>();
      runItems.forEach((item, index) => {
        const created = createdRunItems[index];
        if (!created) {
          return;
        }
        recommendationItemIdByKey.set(item.item_key, created.recommendation_item_id);
      });

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

      const recommendationBars: CartOptimizationRecommendationBar[] = selectedBars.map(
        (bar, index) => ({
          bar_id: `${run.recommendation_run_id}_${bar.bar_type}_${index + 1}`,
          bar_type: bar.bar_type,
          headline: bar.combo.headline,
          value_message: bar.combo.value_message,
          action_label: bar.combo.action_label,
          combo_id: bar.combo.combo_id,
          items: bar.combo.items.map((item) => ({
            recommendation_item_id: recommendationItemIdByKey.get(
              buildComboItemKey({
                bar_type: bar.bar_type,
                combo_id: bar.combo.combo_id,
                item,
              }),
            ),
            sku_id: item.sku_id,
            sku_name: item.sku_name,
            action_type: item.action_type,
            suggested_qty: item.suggested_qty,
            from_qty: item.from_qty,
            to_qty: item.to_qty,
          })),
          explanation: bar.explanation,
        }),
      );

      return {
        recommendationBars,
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

      const strategy = findStrategy(dealer, input.scene);
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
        strategy,
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
