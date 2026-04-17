import type {
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

  return [
    `系统角色：${promptConfig.recommendation_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `避免内容：${promptConfig.global_style.avoid.join(" / ")}`,
    `原因条数上限：${promptConfig.global_style.reason_limit}`,
    `场景：${scene}`,
    `指令：${promptConfig.recommendation_prompt.instruction}`,
    "经销商画像：",
    stringify(dealer),
    "规则配置：",
    stringify(rules),
    "当前活动：",
    stringify(campaigns),
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
    "1. 只返回 JSON 数组，不要 Markdown 代码块，不要额外说明。",
    "2. 每项字段必须包含：sku_id, suggested_qty, reason, reason_tags, priority, action_type。",
    "3. action_type 只能使用 add_to_cart / adjust_qty / replace_item。",
    "4. 如果本意是补货、带搭配或组合补充，统一使用 add_to_cart。",
    "请输出结构化数组。",
  ].join("\n\n");
}

export function buildCartOptimizationPrompt(input: {
  dealer: DealerEntity;
  rules: RuleConfigEntity;
  promptConfig: PromptConfigEntity;
  cartSummary: {
    total_amount: number;
    threshold_amount: number;
    gap_to_threshold: number;
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
    "经销商画像：",
    stringify(dealer),
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
    strategyReferenceBlock(strategy, "box_pair_optimization"),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为 decisions，数组元素字段必须包含：bar_type, combo_id, explanation。",
    "3. bar_type 只能使用 threshold / box_adjustment / pairing。",
    "4. combo_id 只能从提供的候选组合中挑选；不得自造 combo_id。",
    "5. 不得修改 SKU、数量、箱规方向和金额计算，只做选择与解释。",
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
    "经销商画像：",
    stringify(dealer),
    "目标建议项：",
    stringify(targetItems),
    strategyReferenceBlock(strategy, scene),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为 explanations，每条包含 sku_id 和 explanation。",
    "请输出结构化对象 explanations。",
  ].join("\n\n");
}
