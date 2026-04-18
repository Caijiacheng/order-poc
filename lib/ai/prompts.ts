import type {
  BundleTemplateItem,
  BundleTemplateType,
  CampaignEntity,
  DealerEntity,
  ExpressionTemplateEntity,
  ProductEntity,
  PromptConfigEntity,
  RecommendationStrategyEntity,
  RuleConfigEntity,
  SuggestionScene,
} from "@/lib/memory/types";

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function buildDealerPromptProfile(dealer: DealerEntity) {
  return {
    customer_id: dealer.customer_id,
    customer_name: dealer.customer_name,
    city: dealer.city,
    customer_type: dealer.customer_type,
    channel_type: dealer.channel_type,
    order_frequency: dealer.order_frequency,
    last_order_days_ago: dealer.last_order_days_ago,
    price_sensitivity: dealer.price_sensitivity,
    new_product_acceptance: dealer.new_product_acceptance,
    preferred_categories: dealer.preferred_categories,
    business_traits: dealer.business_traits,
    frequent_items: dealer.frequent_items,
    forbidden_items: dealer.forbidden_items,
  };
}

type StrategyPromptReference = Pick<
  RecommendationStrategyEntity,
  "strategy_id" | "strategy_name" | "scene" | "business_notes" | "reference_items"
> & {
  style_hint?: ExpressionTemplateEntity["style_hint"];
};

function strategyReferenceBlock(
  strategy: StrategyPromptReference | undefined,
  scene: SuggestionScene,
) {
  if (!strategy) {
    return `当前场景 ${scene} 无可用策略参考，请仅基于规则和候选集给出建议。`;
  }

  return [
    "以下为当前场景的推荐策略参考（仅参考，不直接照搬）：",
    stringify({
      strategy_id: strategy.strategy_id,
      strategy_name: strategy.strategy_name,
      scene: strategy.scene,
      business_notes: strategy.business_notes,
      style_hint: strategy.style_hint,
      reference_items: strategy.reference_items,
    }),
  ].join("\n");
}

export function buildRecommendationPrompt(input: {
  scene: SuggestionScene;
  dealer: DealerEntity;
  rules: RuleConfigEntity;
  campaigns: CampaignEntity[];
  candidates: ProductEntity[];
  promptConfig: PromptConfigEntity;
  strategy?: StrategyPromptReference;
}) {
  const { scene, dealer, rules, campaigns, candidates, promptConfig, strategy } = input;
  const campaignContextBlock =
    scene === "campaign_stockup" || scene === "weekly_focus"
      ? campaigns.length > 0
        ? [
            "匹配活动（仅可按该活动做活动备货）：",
            stringify(
              campaigns.map((campaign) => ({
                campaign_id: campaign.campaign_id,
                week_id: campaign.week_id,
                campaign_name: campaign.campaign_name,
                weekly_focus_items: campaign.weekly_focus_items,
                promo_threshold: campaign.promo_threshold,
                promo_type: campaign.promo_type,
                activity_notes: campaign.activity_notes,
              })),
            ),
          ]
        : [
            "匹配活动：",
            "当前客户未命中活动，请严格返回 {\"elements\": []}。",
          ]
      : ["当前活动：", stringify(campaigns)];

  return [
    `系统角色：${promptConfig.recommendation_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `避免内容：${promptConfig.global_style.avoid.join(" / ")}`,
    `原因条数上限：${promptConfig.global_style.reason_limit}`,
    `场景：${scene}`,
    `指令：${promptConfig.recommendation_prompt.instruction}`,
    "经销商经营信息：",
    stringify(buildDealerPromptProfile(dealer)),
    "规则配置：",
    stringify(rules),
    ...campaignContextBlock,
    "候选商品（仅可在候选中选择）：",
    stringify(
      candidates.map((item) => ({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        category: item.category,
        spec: item.spec,
        price_per_case: item.price_per_case,
        box_multiple: item.box_multiple,
        tags: item.tags,
        pair_items: item.pair_items,
        is_weekly_focus: item.is_weekly_focus,
      })),
    ),
    strategyReferenceBlock(strategy, scene),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    '2. 对象字段固定为 elements；elements 必须是数组。',
    "3. elements 每项字段必须包含：sku_id, suggested_qty, reason, reason_tags, priority, action_type。",
    "4. sku_id 只能从候选商品中选择；不得自造 sku_id。",
    "5. action_type 只能使用 add_to_cart / adjust_qty / replace_item。",
    "6. 如果本意是补货、带搭配或组合补充，统一使用 add_to_cart。",
    '7. 若没有合适商品，返回 {"elements": []}。',
    "请输出结构化对象 elements。",
  ].join("\n\n");
}

export function buildCartOptimizationPrompt(input: {
  dealer: DealerEntity;
  rules: RuleConfigEntity;
  promptConfig: PromptConfigEntity;
  cartItems: Array<{
    sku_id: string;
    sku_name: string;
    qty: number;
    price_per_case: number;
    line_amount: number;
  }>;
  cartSummary: {
    total_amount: number;
    threshold_amount: number;
    gap_to_threshold: number;
    cart_target_amount: number;
    gap_to_cart_target: number;
  };
  thresholdCombos: Array<{
    combo_id: string;
    headline: string;
    value_message: string;
    items: Array<{ sku_id: string; suggested_qty: number }>;
    deterministic_score: number;
  }>;
  boxAdjustmentCombos: Array<{
    combo_id: string;
    headline: string;
    value_message: string;
    items: Array<{ sku_id: string; from_qty: number; to_qty: number }>;
    deterministic_score: number;
  }>;
  pairingCombos: Array<{
    combo_id: string;
    headline: string;
    value_message: string;
    items: Array<{ sku_id: string; suggested_qty: number }>;
    deterministic_score: number;
  }>;
  strategy?: StrategyPromptReference;
}) {
  const {
    dealer,
    rules,
    promptConfig,
    cartItems,
    cartSummary,
    thresholdCombos,
    boxAdjustmentCombos,
    pairingCombos,
    strategy,
  } = input;

  return [
    `系统角色：${promptConfig.cart_opt_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `指令：${promptConfig.cart_opt_prompt.instruction}`,
    "经销商经营信息：",
    stringify(buildDealerPromptProfile(dealer)),
    "当前购物车商品：",
    stringify(cartItems),
    "规则配置：",
    stringify(rules),
    "购物车摘要：",
    stringify(cartSummary),
    "门槛补齐候选组合（确定性计算结果，仅可选 combo_id）：",
    stringify(thresholdCombos),
    "箱规修正候选组合（确定性计算结果，仅可选 combo_id）：",
    stringify(boxAdjustmentCombos),
    "搭配补充候选组合（确定性计算结果，仅可选 combo_id）：",
    stringify(pairingCombos),
    strategyReferenceBlock(strategy, "checkout_optimization"),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为 decisions，数组元素字段必须包含：bar_type, combo_id, explanation。",
    "3. bar_type 只能使用 threshold / box_adjustment / pairing。",
    "4. combo_id 只能从提供的候选组合中挑选；不得自造 combo_id。",
    "5. 对每个有候选项的 bar_type，必须且只能返回一条 decision；没有候选项的 bar_type 不要返回。",
    "6. 如果三个候选桶都为空，返回 {\"decisions\": []}。",
    "7. 不得修改 SKU、数量、箱规方向和金额计算，只做选择与解释。",
    "请输出一个结构化对象。",
  ].join("\n\n");
}

export function buildExplanationPrompt(input: {
  dealer: DealerEntity;
  scene: SuggestionScene;
  promptConfig: PromptConfigEntity;
  targetItems: Array<{
    sku_id: string;
    sku_name: string;
    suggested_qty: number;
    reason: string;
    reason_tags: string[];
  }>;
  strategy?: StrategyPromptReference;
}) {
  const { dealer, scene, promptConfig, targetItems, strategy } = input;
  return [
    `系统角色：${promptConfig.explain_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `指令：${promptConfig.explain_prompt.instruction}`,
    `场景：${scene}`,
    "经销商经营信息：",
    stringify(buildDealerPromptProfile(dealer)),
    "目标建议项：",
    stringify(targetItems),
    strategyReferenceBlock(strategy, scene),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为 explanations，每条包含 sku_id 和 explanation。",
    "3. sku_id 只能从目标建议项中选择；不得自造 sku_id。",
    "请输出结构化对象 explanations。",
  ].join("\n\n");
}

function describeBundleTemplate(templateType: BundleTemplateType) {
  if (templateType === "hot_sale_restock") {
    return "热销补货：优先补走得快、周转快的商品。";
  }
  if (templateType === "stockout_restock") {
    return "缺货补货：优先补门店常带、容易断货的基础货。";
  }
  return "活动备货：优先补当前活动或周推相关商品。";
}

export function buildBundleRefinementPrompt(input: {
  templateType: BundleTemplateType;
  dealer: DealerEntity;
  rules: RuleConfigEntity;
  campaigns: CampaignEntity[];
  promptConfig: PromptConfigEntity;
  userNeed: string;
  currentItems: BundleTemplateItem[];
  candidates: ProductEntity[];
}) {
  const {
    templateType,
    dealer,
    rules,
    campaigns,
    promptConfig,
    userNeed,
    currentItems,
    candidates,
  } = input;

  return [
    `系统角色：${promptConfig.recommendation_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `避免内容：${promptConfig.global_style.avoid.join(" / ")}`,
    `指令：请根据经销商这次补充的一句需求，重新整理当前这组进货建议。`,
    `模板类型：${describeBundleTemplate(templateType)}`,
    `经销商这次补充的需求：${userNeed}`,
    "经销商经营信息：",
    stringify(buildDealerPromptProfile(dealer)),
    "规则配置：",
    stringify(rules),
    "当前活动：",
    stringify(campaigns),
    "当前这组原建议：",
    stringify(
      currentItems.map((item) => ({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        suggested_qty: item.suggested_qty,
        reason: item.reason,
      })),
    ),
    "可重组选项（只能从这里选）：",
    stringify(
      candidates.map((item) => ({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        category: item.category,
        spec: item.spec,
        price_per_case: item.price_per_case,
        box_multiple: item.box_multiple,
        tags: item.tags,
        pair_items: item.pair_items,
        is_weekly_focus: item.is_weekly_focus,
        is_new_product: item.is_new_product,
      })),
    ),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    '2. 对象字段固定为 elements；elements 必须是数组。',
    "3. 只保留 2 到 5 个最适合本次需求的商品。",
    "4. elements 每项字段必须包含：sku_id, suggested_qty, reason, reason_tags, priority, action_type。",
    "5. sku_id 只能从可重组选项中选择；不得自造 sku_id。",
    "6. action_type 统一返回 add_to_cart。",
    "7. reason 要直接说明为什么这次该带这款货，不要写系统口吻。",
    "请输出结构化对象 elements。",
  ].join("\n\n");
}
