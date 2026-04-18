import {
  buildBundleRefinementPrompt,
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
  matchCampaignsForDealer,
  selectCampaignStockupCandidates,
  selectDailyRecommendationCandidates,
  selectHotSaleRestockCandidates,
  selectStockoutRestockCandidates,
  selectWeeklyFocusCandidates,
} from "@/lib/domain/recommendation-rules";
import { appendMetricEvent, getMemoryStore, nowIso } from "@/lib/memory/store";
import type {
  BundleTemplateItem,
  BundleTemplateType,
  CampaignEntity,
  CartOptimizationBarType,
  CartOptimizationRecommendationBar,
  DealerEntity,
  FrontstagePageName,
  ProductEntity,
  RecommendationStrategyEntity,
  RuleConfigEntity,
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

type PurchaseRecommendationScene = Extract<
  SuggestionScene,
  "hot_sale_restock" | "stockout_restock" | "campaign_stockup"
>;

type LegacyPurchaseRecommendationScene = Extract<
  SuggestionScene,
  "daily_recommendation" | "weekly_focus"
>;

type RuntimeRecommendationScene =
  | PurchaseRecommendationScene
  | LegacyPurchaseRecommendationScene;

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
  if (
    runtimeScene === "hot_sale_restock" ||
    runtimeScene === "stockout_restock" ||
    runtimeScene === "campaign_stockup" ||
    runtimeScene === "checkout_optimization"
  ) {
    return strategyScene === runtimeScene;
  }
  if (runtimeScene === "daily_recommendation") {
    return strategyScene === "stockout_restock" || strategyScene === "hot_sale_restock";
  }
  if (runtimeScene === "weekly_focus") {
    return strategyScene === "campaign_stockup";
  }
  if (runtimeScene === "box_pair_optimization" || runtimeScene === "threshold_topup") {
    return strategyScene === "checkout_optimization";
  }
  return false;
}

function strategySceneRankForRuntime(input: {
  strategyScene: RecommendationStrategyEntity["scene"];
  runtimeScene: SuggestionScene;
}) {
  const { strategyScene, runtimeScene } = input;
  if (
    runtimeScene === "hot_sale_restock" ||
    runtimeScene === "stockout_restock" ||
    runtimeScene === "campaign_stockup" ||
    runtimeScene === "checkout_optimization"
  ) {
    return strategyScene === runtimeScene ? 0 : 9;
  }
  if (runtimeScene === "daily_recommendation") {
    if (strategyScene === "stockout_restock") return 0;
    if (strategyScene === "hot_sale_restock") return 1;
    return 9;
  }
  if (runtimeScene === "weekly_focus") {
    return strategyScene === "campaign_stockup" ? 0 : 9;
  }
  if (runtimeScene === "box_pair_optimization" || runtimeScene === "threshold_topup") {
    return strategyScene === "checkout_optimization" ? 0 : 9;
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

function toRecommendationFunctionId(scene: RuntimeRecommendationScene) {
  if (scene === "hot_sale_restock") {
    return "ai.generate-hot-sale-restock-recommendation";
  }
  if (scene === "stockout_restock") {
    return "ai.generate-stockout-restock-recommendation";
  }
  if (scene === "campaign_stockup") {
    return "ai.generate-campaign-stockup-recommendation";
  }
  return scene === "daily_recommendation"
    ? "ai.generate-daily-recommendation"
    : "ai.generate-weekly-focus-recommendation";
}

function toRecommendationEffectType(scene: RuntimeRecommendationScene) {
  return scene === "campaign_stockup" || scene === "weekly_focus"
    ? "weekly_focus"
    : "replenishment";
}

function getRecommendationSceneLabel(scene: SuggestionScene) {
  if (scene === "hot_sale_restock") {
    return "热销补货";
  }
  if (scene === "stockout_restock") {
    return "缺货补货";
  }
  if (scene === "campaign_stockup" || scene === "weekly_focus") {
    return "活动备货";
  }
  if (scene === "checkout_optimization") {
    return "凑单推荐";
  }
  return "采购页组货建议";
}

function getCartBarLabel(barType: CartOptimizationBarType) {
  if (barType === "threshold") {
    return "凑够起订额";
  }
  if (barType === "box_adjustment") {
    return "补齐整箱";
  }
  return "搭配补货";
}

function summarizeRecommendationItems(
  items: Array<{
    sku_name: string;
    suggested_qty: number;
    reason: string;
  }>,
) {
  return items.slice(0, 5).map((item) => ({
    商品: item.sku_name,
    建议箱数: item.suggested_qty,
    推荐原因: item.reason,
  }));
}

function summarizeBundleItems(items: BundleTemplateItem[]) {
  return items.slice(0, 5).map((item) => ({
    商品: item.sku_name,
    建议箱数: item.suggested_qty,
    行金额: item.line_amount,
    推荐原因: item.reason,
  }));
}

function summarizeSceneResult(input: {
  scene: RuntimeRecommendationScene;
  result: {
    run: {
      recommendation_run_id: string;
      campaign_id?: string;
    };
    items: Array<{
      sku_name: string;
      suggested_qty: number;
      reason: string;
    }>;
  };
}) {
  return {
    场景: getRecommendationSceneLabel(input.scene),
    runId: input.result.run.recommendation_run_id,
    活动ID: input.result.run.campaign_id,
    建议商品数: input.result.items.length,
    建议商品: summarizeRecommendationItems(input.result.items),
  };
}

function buildRecommendationCandidates(input: {
  scene: RuntimeRecommendationScene;
  store: ReturnType<typeof getMemoryStore>;
  dealer: DealerEntity;
  selectedCampaign?: CampaignEntity;
}) {
  if (input.scene === "hot_sale_restock") {
    return selectHotSaleRestockCandidates({
      products: input.store.products,
      dealer: input.dealer,
      rules: input.store.rules,
    });
  }
  if (input.scene === "stockout_restock") {
    return selectStockoutRestockCandidates({
      products: input.store.products,
      dealer: input.dealer,
      rules: input.store.rules,
    });
  }
  if (input.scene === "campaign_stockup") {
    return selectCampaignStockupCandidates({
      products: input.store.products,
      campaign: input.selectedCampaign,
      dealer: input.dealer,
      rules: input.store.rules,
    });
  }
  if (input.scene === "weekly_focus") {
    return selectCampaignStockupCandidates({
      products: input.store.products,
      campaign: input.selectedCampaign,
      dealer: input.dealer,
      rules: input.store.rules,
    });
  }
  if (input.scene === "daily_recommendation") {
    return selectDailyRecommendationCandidates({
      products: input.store.products,
      dealer: input.dealer,
      rules: input.store.rules,
    });
  }
  return selectWeeklyFocusCandidates({
    products: input.store.products,
    campaigns: input.store.campaigns,
    dealer: input.dealer,
    rules: input.store.rules,
  });
}

function resolveMatchedCampaignsForDealer(input: {
  store: ReturnType<typeof getMemoryStore>;
  dealer: DealerEntity;
}) {
  return matchCampaignsForDealer({
    campaigns: input.store.campaigns,
    dealer: input.dealer,
    dealerSegments: input.store.dealerSegments,
    products: input.store.products,
  });
}

function buildMockRecommendationItems(
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

function containsAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function scoreBundleRefinementCandidate(input: {
  product: ProductEntity;
  dealer: DealerEntity;
  templateType: BundleTemplateType;
  currentSkuIds: Set<string>;
  userNeed: string;
}) {
  const { product, dealer, templateType, currentSkuIds, userNeed } = input;
  let score = currentSkuIds.has(product.sku_id) ? 220 : 0;

  if (templateType === "hot_sale_restock") {
    if (product.tags.some((tag) => tag.includes("高频") || tag.includes("动销"))) {
      score += 70;
    }
    if (dealer.frequent_items.includes(product.sku_id)) {
      score += 60;
    }
  } else if (templateType === "stockout_restock") {
    if (dealer.frequent_items.includes(product.sku_id)) {
      score += 90;
    }
    if (product.tags.some((tag) => tag.includes("常购"))) {
      score += 35;
    }
  } else {
    if (product.is_weekly_focus || product.tags.some((tag) => tag.includes("活动"))) {
      score += 90;
    }
  }

  if (containsAnyKeyword(userNeed, ["小包装", "小规格", "便利"])) {
    if (
      product.sku_name.includes("小包装") ||
      product.spec.includes("250") ||
      product.spec.includes("230")
    ) {
      score += 120;
    }
  }

  if (containsAnyKeyword(userNeed, ["大包装", "餐饮", "档口", "大桶"])) {
    if (
      product.sku_name.includes("大包装") ||
      product.spec.includes("1kg") ||
      product.spec.includes("2270")
    ) {
      score += 120;
    }
  }

  if (containsAnyKeyword(userNeed, ["活动", "推广", "冲量"])) {
    if (product.is_weekly_focus || product.tags.some((tag) => tag.includes("活动"))) {
      score += 120;
    }
  }

  if (containsAnyKeyword(userNeed, ["新品", "上新"])) {
    if (product.is_new_product) {
      score += 90;
    }
  }

  if (containsAnyKeyword(userNeed, ["搭配", "顺带"])) {
    if (product.pair_items.length > 0) {
      score += 60;
    }
  }

  return score;
}

function buildBundleRefinementMockItems(input: {
  candidates: ProductEntity[];
  dealer: DealerEntity;
  templateType: BundleTemplateType;
  currentItems: BundleTemplateItem[];
  userNeed: string;
}): RecommendationItemOutput[] {
  const currentQtyMap = new Map(
    input.currentItems.map((item) => [item.sku_id, item.suggested_qty]),
  );
  const currentSkuIds = new Set(input.currentItems.map((item) => item.sku_id));
  const count = Math.min(5, Math.max(2, input.currentItems.length || 3));

  return [...input.candidates]
    .sort((left, right) => {
      const leftScore = scoreBundleRefinementCandidate({
        product: left,
        dealer: input.dealer,
        templateType: input.templateType,
        currentSkuIds,
        userNeed: input.userNeed,
      });
      const rightScore = scoreBundleRefinementCandidate({
        product: right,
        dealer: input.dealer,
        templateType: input.templateType,
        currentSkuIds,
        userNeed: input.userNeed,
      });
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.display_order - right.display_order;
    })
    .slice(0, count)
    .map((product, index) => ({
      sku_id: product.sku_id,
      suggested_qty: Math.max(
        1,
        currentQtyMap.get(product.sku_id) ?? product.box_multiple,
      ),
      reason: `${product.sku_name}更贴近这次“${input.userNeed.trim()}”的带货方向。`,
      reason_tags: ["补充需求", "AI组货"],
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
    if (!product) {
      throw new BusinessError(
        "LLM_INVALID_OUTPUT",
        `模型返回了不在候选集中的 sku_id: ${raw.sku_id}`,
        502,
      );
    }
    if (dedup.has(raw.sku_id)) {
      throw new BusinessError(
        "LLM_INVALID_OUTPUT",
        `模型返回了重复的 sku_id: ${raw.sku_id}`,
        502,
      );
    }
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

  return normalized.sort((left, right) => left.priority - right.priority);
}

function buildBundleRefinementCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  templateType: BundleTemplateType;
  rules: RuleConfigEntity;
  selectedCampaign?: CampaignEntity;
  currentItems: BundleTemplateItem[];
  userNeed: string;
}) {
  const baseCandidates =
    input.templateType === "hot_sale_restock"
      ? selectHotSaleRestockCandidates({
          products: input.products,
          dealer: input.dealer,
          rules: input.rules,
        })
      : input.templateType === "stockout_restock"
        ? selectStockoutRestockCandidates({
            products: input.products,
            dealer: input.dealer,
            rules: input.rules,
          })
        : selectCampaignStockupCandidates({
            products: input.products,
            campaign: input.selectedCampaign,
            dealer: input.dealer,
            rules: input.rules,
          });

  const userNeedText = input.userNeed.trim().toLowerCase();
  const currentSkuIds = new Set(input.currentItems.map((item) => item.sku_id));
  const needMatches = input.products.filter((product) => {
    if (product.status !== "active") {
      return false;
    }
    if (input.dealer.forbidden_items.includes(product.sku_id)) {
      return false;
    }
    if (!input.rules.allow_new_product_recommendation && product.is_new_product) {
      return false;
    }
    if (containsAnyKeyword(userNeedText, ["小包装", "小规格", "便利"])) {
      return product.sku_name.includes("小包装") || product.spec.includes("250");
    }
    if (containsAnyKeyword(userNeedText, ["大包装", "餐饮", "档口", "大桶"])) {
      return product.sku_name.includes("大包装") || product.spec.includes("1kg");
    }
    if (containsAnyKeyword(userNeedText, ["活动", "推广", "冲量"])) {
      return product.is_weekly_focus;
    }
    if (containsAnyKeyword(userNeedText, ["新品", "上新"])) {
      return product.is_new_product;
    }
    return currentSkuIds.has(product.sku_id);
  });

  return Array.from(
    new Map(
      [...input.currentItems.map((item) => item.sku_id), ...baseCandidates.map((item) => item.sku_id), ...needMatches.map((item) => item.sku_id)]
        .map((skuId) => input.products.find((product) => product.sku_id === skuId))
        .filter((item): item is ProductEntity => Boolean(item))
        .map((item) => [item.sku_id, item]),
    ).values(),
  ).slice(0, 14);
}

export async function refineBundleTemplateForCustomer(input: {
  customer_id: string;
  template_type: BundleTemplateType;
  current_items: BundleTemplateItem[];
  user_need: string;
}) {
  const store = getMemoryStore();
  const userNeed = input.user_need.trim();
  if (!userNeed) {
    throw new BusinessError("VALIDATION_ERROR", "请先补一句这次需求", 400);
  }
  const dealer = findDealer(input.customer_id);

  return withSpan(
    "purchase.refine-bundle",
    {
      "customer.id": input.customer_id,
      "bundle.type": input.template_type,
    },
    async (traceId) => {
      const matchedCampaigns = resolveMatchedCampaignsForDealer({ store, dealer });
      const selectedCampaign =
        input.template_type === "campaign_stockup"
          ? matchedCampaigns[0]?.campaign
          : undefined;
      const candidates = buildBundleRefinementCandidates({
        products: store.products,
        dealer,
        templateType: input.template_type,
        rules: store.rules,
        selectedCampaign,
        currentItems: input.current_items,
        userNeed,
      });

      const prompt = buildBundleRefinementPrompt({
        templateType: input.template_type,
        dealer,
        rules: store.rules,
        campaigns:
          input.template_type === "campaign_stockup"
            ? selectedCampaign
              ? [selectedCampaign]
              : []
            : store.campaigns,
        promptConfig: store.promptConfig,
        userNeed,
        currentItems: input.current_items,
        candidates,
      });

      const aiResult = await generateRecommendationItems({
        prompt,
        mockItems: buildBundleRefinementMockItems({
          candidates,
          dealer,
          templateType: input.template_type,
          currentItems: input.current_items,
          userNeed,
        }),
        functionId: "ai.refine-bundle-template",
        telemetryMetadata: {
          trace_id: traceId,
          customer_id: dealer.customer_id,
          template_type: input.template_type,
        },
      });

      updateModelMetrics(aiResult.meta);

      const normalizedItems = normalizeRecommendationItems({
        rawItems: aiResult.items,
        candidates,
      });

      if (normalizedItems.length === 0) {
        throw new BusinessError("LLM_INVALID_OUTPUT", "AI 组货未返回可用商品", 502);
      }

      const currentQtyMap = new Map(
        input.current_items.map((item) => [item.sku_id, item.suggested_qty]),
      );
      const items = normalizedItems.slice(0, 5).map((item) => {
        const product = candidates.find((candidate) => candidate.sku_id === item.sku_id);
        if (!product) {
          throw new BusinessError(
            "LLM_INVALID_OUTPUT",
            `AI 组货返回了无效 sku_id: ${item.sku_id}`,
            502,
          );
        }
        const suggestedQty = Math.max(
          1,
          currentQtyMap.get(item.sku_id) ?? item.suggested_qty ?? product.box_multiple,
        );
        return {
          recommendation_item_id: undefined,
          sku_id: item.sku_id,
          sku_name: product.sku_name,
          suggested_qty: suggestedQty,
          reason: item.reason,
          reason_tags: item.reason_tags,
          priority: item.priority,
          action_type: "add_to_cart" as const,
          unit_price: product.price_per_case,
          line_amount: product.price_per_case * suggestedQty,
        } satisfies BundleTemplateItem;
      });

      return {
        trace_id: traceId,
        summary: `已按“${userNeed}”重新组货，这组现在会更贴近你这次的补货方向。`,
        items,
      };
    },
    {
      input: {
        中文说明: "这是采购页详情抽屉里的 AI 快速组货请求。",
        经销商ID: dealer.customer_id,
        经销商名称: dealer.customer_name,
        模板类型: getRecommendationSceneLabel(input.template_type),
        本次需求: userNeed,
        当前模板商品: summarizeBundleItems(input.current_items),
      },
      output: (result) => ({
        中文说明: "AI 已根据这次补货需求重组该模板。",
        经销商名称: dealer.customer_name,
        模板类型: getRecommendationSceneLabel(input.template_type),
        结果摘要: result.summary,
        建议商品数: result.items.length,
        建议商品: summarizeBundleItems(result.items),
      }),
    },
  );
}

function validateExplanationOutput(input: {
  explanations: ExplanationOutput["explanations"];
  targetItems: Array<{ sku_id: string }>;
}) {
  const targetSkuIds = new Set(input.targetItems.map((item) => item.sku_id));
  const seen = new Set<string>();

  for (const item of input.explanations) {
    if (!targetSkuIds.has(item.sku_id)) {
      throw new BusinessError(
        "LLM_INVALID_OUTPUT",
        `模型返回了不在目标集合中的 explanation sku_id: ${item.sku_id}`,
        502,
      );
    }
    if (seen.has(item.sku_id)) {
      throw new BusinessError(
        "LLM_INVALID_OUTPUT",
        `模型返回了重复的 explanation sku_id: ${item.sku_id}`,
        502,
      );
    }
    seen.add(item.sku_id);
  }
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

async function generateRecommendationScene(input: {
  traceId: string;
  session_id: string;
  customer_id: string;
  dealer: DealerEntity;
  scene: RuntimeRecommendationScene;
  trigger_source: "auto" | "manual" | "assistant";
  page_name: FrontstagePageName;
}) {
  const store = getMemoryStore();
  setCartCustomer(input.session_id, input.dealer.customer_id);
  const matchedCampaigns =
    input.scene === "campaign_stockup" || input.scene === "weekly_focus"
      ? resolveMatchedCampaignsForDealer({ store, dealer: input.dealer })
      : [];
  const selectedCampaign = matchedCampaigns[0]?.campaign;

  const candidates = buildRecommendationCandidates({
    scene: input.scene,
    store,
    dealer: input.dealer,
    selectedCampaign,
  });
  expireOpenItemsForScene({
    customer_id: input.dealer.customer_id,
    scene: input.scene,
  });

  const strategy = findStrategy(input.dealer, input.scene);
  const prompt = buildRecommendationPrompt({
    scene: input.scene,
    dealer: input.dealer,
    rules: store.rules,
    campaigns:
      input.scene === "campaign_stockup" || input.scene === "weekly_focus"
        ? selectedCampaign
          ? [selectedCampaign]
          : []
        : store.campaigns,
    candidates,
    promptConfig: store.promptConfig,
    strategy,
  });

  if (
    (input.scene === "campaign_stockup" || input.scene === "weekly_focus") &&
    !selectedCampaign
  ) {
    const run = createRecommendationRun({
      session_id: input.session_id,
      trace_id: input.traceId,
      function_id: toRecommendationFunctionId(input.scene),
      telemetry_metadata: {
        scene: input.scene,
        generated_at: nowIso(),
        campaign_id: undefined,
      },
      customer_id: input.dealer.customer_id,
      customer_name: input.dealer.customer_name,
      scene: input.scene,
      surface: "purchase",
      generation_mode: "precomputed",
      business_date: new Date().toISOString().slice(0, 10),
      snapshot_version: "runtime_precompute_v1",
      campaign_id: undefined,
      page_name: input.page_name,
      trigger_source: input.trigger_source,
      strategy_id: strategy?.strategy_id,
      expression_template_id: strategy?.expression_template_id,
      prompt_version: "runtime",
      prompt_snapshot: prompt,
      response_snapshot: JSON.stringify({ elements: [] }, null, 2),
      candidate_sku_ids: [],
      returned_sku_ids: [],
      model_name: "rule.match-only.no-campaign",
      model_latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
    });

    store.metrics.weeklyFocusRequests += 1;
    store.metrics.customerSceneBreakdown[
      `${input.dealer.customer_id}_${input.scene}`
    ] = (store.metrics.customerSceneBreakdown[
      `${input.dealer.customer_id}_${input.scene}`
    ] ?? 0) + 1;

    return {
      run,
      items: [],
    };
  }

  const aiResult = await generateRecommendationItems({
    prompt,
    mockItems: buildMockRecommendationItems(candidates),
    functionId: toRecommendationFunctionId(input.scene),
    telemetryMetadata: {
      trace_id: input.traceId,
      customer_id: input.dealer.customer_id,
      scene: input.scene,
      session_id: input.session_id,
      campaign_id: selectedCampaign?.campaign_id,
    },
  });

  updateModelMetrics(aiResult.meta);

  const normalizedItems = normalizeRecommendationItems({
    rawItems: aiResult.items,
    candidates,
  });
  const run = createRecommendationRun({
    session_id: input.session_id,
    trace_id: input.traceId,
    function_id: toRecommendationFunctionId(input.scene),
    telemetry_metadata: {
      scene: input.scene,
      generated_at: nowIso(),
      campaign_id: selectedCampaign?.campaign_id,
    },
    customer_id: input.dealer.customer_id,
    customer_name: input.dealer.customer_name,
    scene: input.scene,
    surface: "purchase",
    generation_mode: "precomputed",
    business_date: new Date().toISOString().slice(0, 10),
    snapshot_version: "runtime_precompute_v1",
    campaign_id:
      input.scene === "campaign_stockup" || input.scene === "weekly_focus"
        ? selectedCampaign?.campaign_id
        : undefined,
    page_name: input.page_name,
    trigger_source: input.trigger_source,
    strategy_id: strategy?.strategy_id,
    expression_template_id: strategy?.expression_template_id,
    prompt_version: "runtime",
    prompt_snapshot: prompt,
    response_snapshot: JSON.stringify({ elements: aiResult.items }, null, 2),
    candidate_sku_ids: candidates.map((item) => item.sku_id),
    returned_sku_ids: normalizedItems.map((item) => item.sku_id),
    model_name: aiResult.meta.model_name,
    model_latency_ms: aiResult.meta.model_latency_ms,
    input_tokens: aiResult.meta.input_tokens,
    output_tokens: aiResult.meta.output_tokens,
  });
  const records = createRecommendationItems(
    run,
    normalizedItems.map((item, index) => ({
      ...item,
      suggested_rank: index + 1,
      effect_type: toRecommendationEffectType(input.scene),
    })),
  );

  if (input.scene === "campaign_stockup" || input.scene === "weekly_focus") {
    store.metrics.weeklyFocusRequests += 1;
  } else {
    store.metrics.recommendationRequests += 1;
  }
  store.metrics.customerSceneBreakdown[
    `${input.dealer.customer_id}_${input.scene}`
  ] = (store.metrics.customerSceneBreakdown[
    `${input.dealer.customer_id}_${input.scene}`
  ] ?? 0) + 1;

  return {
    run,
    items: attachRecommendationItemIds({
      items: normalizedItems,
      records,
    }),
  };
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
      headline: `凑单推荐：${candidate.sku_name}`,
      value_message: `预计补入 ${formatCny(lineAmount)}，帮助贴近当前凑单差额 ${formatCny(
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
  const dealer = findDealer(input.customer_id);

  return withSpan(
    "homepage.generate-recommendations",
    {
      "customer.id": input.customer_id,
      "session.id": input.session_id,
    },
    async (traceId) => {
      const [hotSaleResult, stockoutResult, campaignResult] = await Promise.all([
        generateRecommendationScene({
          traceId,
          session_id: input.session_id,
          customer_id: input.customer_id,
          dealer,
          scene: "hot_sale_restock",
          trigger_source: triggerSource,
          page_name: pageName,
        }),
        generateRecommendationScene({
          traceId,
          session_id: input.session_id,
          customer_id: input.customer_id,
          dealer,
          scene: "stockout_restock",
          trigger_source: triggerSource,
          page_name: pageName,
        }),
        generateRecommendationScene({
          traceId,
          session_id: input.session_id,
          customer_id: input.customer_id,
          dealer,
          scene: "campaign_stockup",
          trigger_source: triggerSource,
          page_name: pageName,
        }),
      ]);

      return {
        hotSaleRestockRecommendations: hotSaleResult.items,
        stockoutRestockRecommendations: stockoutResult.items,
        campaignStockupRecommendations: campaignResult.items,
        summary: {
          trace_id: traceId,
          hot_sale_run_id: hotSaleResult.run.recommendation_run_id,
          stockout_run_id: stockoutResult.run.recommendation_run_id,
          campaign_run_id: campaignResult.run.recommendation_run_id,
        },
      };
    },
    {
      input: {
        中文说明: "这是采购页三张预生成补货卡的一次业务生成请求。",
        经销商ID: dealer.customer_id,
        经销商名称: dealer.customer_name,
        会话ID: input.session_id,
        页面: pageName,
        触发方式: triggerSource,
        本次生成场景: ["热销补货", "缺货补货", "活动备货"],
      },
      output: (result) => ({
        中文说明: "采购页三张补货卡已经生成完成，每张卡都有独立 run。",
        经销商名称: dealer.customer_name,
        热销补货: summarizeSceneResult({
          scene: "hot_sale_restock",
          result: {
            run: { recommendation_run_id: result.summary.hot_sale_run_id },
            items: result.hotSaleRestockRecommendations,
          },
        }),
        缺货补货: summarizeSceneResult({
          scene: "stockout_restock",
          result: {
            run: { recommendation_run_id: result.summary.stockout_run_id },
            items: result.stockoutRestockRecommendations,
          },
        }),
        活动备货: summarizeSceneResult({
          scene: "campaign_stockup",
          result: {
            run: { recommendation_run_id: result.summary.campaign_run_id },
            items: result.campaignStockupRecommendations,
          },
        }),
      }),
    },
  );
}

export async function generateRecommendationSceneForCustomer(input: {
  session_id: string;
  customer_id: string;
  scene: RuntimeRecommendationScene;
  trigger_source?: "auto" | "manual" | "assistant";
  page_name?: FrontstagePageName;
}) {
  const triggerSource = input.trigger_source ?? "assistant";
  const pageName = input.page_name ?? "/purchase";
  const dealer = findDealer(input.customer_id);

  return withSpan(
    "recommendation.generate-scene",
    {
      "customer.id": input.customer_id,
      "session.id": input.session_id,
      "recommendation.scene": input.scene,
    },
    async (traceId) => {
      const result = await generateRecommendationScene({
        traceId,
        session_id: input.session_id,
        customer_id: input.customer_id,
        dealer,
        scene: input.scene,
        trigger_source: triggerSource,
        page_name: pageName,
      });

      return {
        recommendations: result.items,
        summary: {
          trace_id: traceId,
          run_id: result.run.recommendation_run_id,
        },
      };
    },
    {
      input: {
        中文说明: "这是单个采购场景的建议生成请求。",
        经销商ID: dealer.customer_id,
        经销商名称: dealer.customer_name,
        会话ID: input.session_id,
        页面: pageName,
        触发方式: triggerSource,
        生成场景: getRecommendationSceneLabel(input.scene),
      },
      output: (result) => ({
        中文说明: "单个采购场景建议已经生成完成。",
        经销商名称: dealer.customer_name,
        场景结果: summarizeSceneResult({
          scene: input.scene,
          result: {
            run: { recommendation_run_id: result.summary.run_id },
            items: result.recommendations,
          },
        }),
      }),
    },
  );
}

export async function generateCartOptimizationForSession(input: {
  session_id: string;
  customer_id?: string;
  cart_items?: Array<{ sku_id: string; qty: number }>;
}) {
  const store = getMemoryStore();
  const activeDealer = input.customer_id ? findDealer(input.customer_id) : undefined;

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

      const {
        session,
        dealer,
        thresholdGap,
        thresholdCandidates,
        boxAdjustments,
        pairSuggestions,
      } =
        buildDeterministicCartInsights(input.session_id, input.customer_id);
      const productMap = new Map(store.products.map((item) => [item.sku_id, item]));

      const thresholdCombos = buildThresholdCombos({
        candidates: thresholdCandidates,
        productMap,
        gap: thresholdGap,
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

      const strategy = findStrategy(dealer, "checkout_optimization");
      const prompt = buildCartOptimizationPrompt({
        dealer,
        rules: store.rules,
        promptConfig: store.promptConfig,
        cartItems: session.items.map((item) => ({
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          qty: item.qty,
          price_per_case: item.price_per_case,
          line_amount: item.qty * item.price_per_case,
        })),
        cartSummary: {
          total_amount: session.summary.total_amount,
          threshold_amount: session.summary.threshold_amount,
          gap_to_threshold: session.summary.gap_to_threshold,
          cart_target_amount: store.rules.cart_target_amount,
          gap_to_cart_target: thresholdGap,
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

      const mockOutput: CartOptimizationOutput = {
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

      const aiResult = await generateCartOptimization({
        prompt,
        mockOutput,
        functionId: "ai.generate-cart-optimization",
        telemetryMetadata: {
          trace_id: traceId,
          customer_id: dealer.customer_id,
          scene: "checkout_optimization",
          session_id: input.session_id,
        },
      });
      const selectedOutput = aiResult.output;
      const modelMeta = aiResult.meta;
      updateModelMetrics(aiResult.meta);

      const decisionByType = new Map<
        CartOptimizationBarType,
        {
          combo_id: string;
          explanation: string;
        }
      >();
      for (const decision of selectedOutput.decisions) {
        if (decisionByType.has(decision.bar_type)) {
          throw new BusinessError(
            "LLM_INVALID_OUTPUT",
            `模型为 ${decision.bar_type} 返回了重复 decision`,
            502,
          );
        }
        const matchedCombo = combosByType[decision.bar_type].find(
          (item) => item.combo_id === decision.combo_id,
        );
        if (!matchedCombo) {
          throw new BusinessError(
            "LLM_INVALID_OUTPUT",
            `模型为 ${decision.bar_type} 返回了无效 combo_id: ${decision.combo_id}`,
            502,
          );
        }
        decisionByType.set(decision.bar_type, {
          combo_id: decision.combo_id,
          explanation: decision.explanation.trim(),
        });
      }

      const requiredBarTypes = CART_BAR_ORDER.filter((barType) => combosByType[barType].length > 0);
      const missingBarTypes = requiredBarTypes.filter((barType) => !decisionByType.has(barType));
      if (missingBarTypes.length > 0) {
        throw new BusinessError(
          "LLM_INVALID_OUTPUT",
          `模型未为以下 bar_type 返回 decision: ${missingBarTypes.join(", ")}`,
          502,
        );
      }

      const selectedBars = CART_BAR_ORDER.flatMap((barType) => {
        const candidates = combosByType[barType];
        if (candidates.length === 0) {
          return [];
        }

        const decision = decisionByType.get(barType);
        if (!decision) {
          return [];
        }
        const selectedCombo = candidates.find((item) => item.combo_id === decision.combo_id);
        if (!selectedCombo) {
          throw new BusinessError(
            "LLM_INVALID_OUTPUT",
            `模型为 ${barType} 返回了未定义的 combo_id: ${decision.combo_id}`,
            502,
          );
        }
        if (!decision.explanation) {
          throw new BusinessError(
            "LLM_INVALID_OUTPUT",
            `模型为 ${barType} 返回了空 explanation`,
            502,
          );
        }

        return {
          bar_type: barType,
          combo: selectedCombo,
          explanation: decision.explanation,
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
          scene: "checkout_optimization",
          generated_at: nowIso(),
        },
        customer_id: dealer.customer_id,
        customer_name: dealer.customer_name,
        scene: "checkout_optimization",
        surface: "checkout",
        generation_mode: "realtime",
        business_date: new Date().toISOString().slice(0, 10),
        snapshot_version: "runtime_realtime_v1",
        page_name: "/order-submit",
        trigger_source: "assistant",
        strategy_id: strategy?.strategy_id,
        expression_template_id: strategy?.expression_template_id,
        prompt_version: "runtime",
        prompt_snapshot: prompt,
        response_snapshot: JSON.stringify(selectedOutput, null, 2),
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
        runItems.map((item) => ({
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          suggested_qty: item.suggested_qty,
          suggested_rank: item.suggested_rank,
          reason: item.reason,
          reason_tags: item.reason_tags,
          action_type: item.action_type,
          effect_type: item.effect_type,
        })),
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
        scene: "checkout_optimization",
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
    {
      input: {
        中文说明: "这是结算页实时凑单推荐请求，会基于当前购物车即时计算并调用模型决策。",
        会话ID: input.session_id,
        经销商ID: activeDealer?.customer_id ?? input.customer_id ?? "unknown",
        经销商名称: activeDealer?.customer_name ?? "未绑定经销商",
        购物车来源:
          input.cart_items && input.cart_items.length > 0
            ? "本次请求显式传入购物车商品"
            : "沿用当前 session 里的购物车商品",
        传入商品:
          input.cart_items?.map((item) => ({
            sku_id: item.sku_id,
            箱数: item.qty,
          })) ?? [],
      },
      output: (result) => ({
        中文说明: "结算页实时凑单推荐已经生成完成，下面是本次返回的推荐条。",
        经销商名称: activeDealer?.customer_name ?? "未绑定经销商",
        recommendationRunId: result.summary.recommendation_run_id,
        推荐条数量: result.recommendationBars.length,
        推荐条: result.recommendationBars.map((bar) => ({
          类型: getCartBarLabel(bar.bar_type),
          标题: bar.headline,
          动作按钮: bar.action_label,
          推荐商品: bar.items.map((item) => ({
            商品: item.sku_name,
            建议箱数: item.to_qty ?? item.suggested_qty,
            动作: item.action_type,
          })),
          解释: bar.explanation,
        })),
        当前购物车摘要: {
          SKU数: result.summary.cart.sku_count,
          件数: result.summary.cart.item_count,
          当前金额: result.summary.cart.total_amount,
          起订金额: result.summary.cart.threshold_amount,
          距离起订额差额: result.summary.cart.gap_to_threshold,
        },
      }),
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
  const dealer = findDealer(input.customer_id);

  return withSpan(
    "recommendation.explain",
    {
      "session.id": input.session_id,
      "customer.id": input.customer_id,
      scene: input.scene,
    },
    async (traceId) => {
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

      const mockOutput: ExplanationOutput = {
        explanations: updatedItems.map((item) => ({
          sku_id: item.sku_id,
          explanation: `${item.sku_name}：${item.reason}`,
        })),
      };

      const aiResult = await generateExplanation({
        prompt,
        mockOutput,
        functionId: "recommendation.explain",
        telemetryMetadata: {
          trace_id: traceId,
          customer_id: dealer.customer_id,
          scene: input.scene,
          session_id: input.session_id,
        },
      });
      updateModelMetrics(aiResult.meta);
      validateExplanationOutput({
        explanations: aiResult.output.explanations,
        targetItems: updatedItems,
      });

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
    {
      input: {
        中文说明: "这是推荐理由解释请求，会针对指定推荐商品生成可读说明。",
        经销商ID: dealer.customer_id,
        经销商名称: dealer.customer_name,
        会话ID: input.session_id,
        场景: getRecommendationSceneLabel(input.scene),
        目标SKU: input.target_sku_ids,
      },
      output: (result) => ({
        中文说明: "推荐理由解释已经生成完成。",
        经销商名称: dealer.customer_name,
        场景: getRecommendationSceneLabel(input.scene),
        标题: result.title,
        解释条数: result.summary.count,
        解释结果: result.explanations.map((item) => ({
          sku_id: item.sku_id,
          解释: item.explanation,
        })),
      }),
    },
  );
}
