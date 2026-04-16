import type {
  CampaignEntity,
  DealerEntity,
  DealerSuggestionTemplateEntity,
  ProductEntity,
  PromptConfigEntity,
  RuleConfigEntity,
  SuggestionScene,
} from "@/lib/memory/types";

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function templateReferenceBlock(
  template: DealerSuggestionTemplateEntity | undefined,
  scene: SuggestionScene,
) {
  if (!template) {
    return `当前场景 ${scene} 无可用模板，请仅基于规则和候选集给出建议。`;
  }

  return [
    "以下为经销商建议模板参考（仅参考，不直接照搬）：",
    stringify({
      template_id: template.template_id,
      template_name: template.template_name,
      scene: template.scene,
      business_notes: template.business_notes,
      style_hint: template.style_hint,
      reference_items: template.reference_items,
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
  template?: DealerSuggestionTemplateEntity;
}) {
  const { scene, dealer, rules, campaigns, candidates, promptConfig, template } = input;

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
    templateReferenceBlock(template, scene),
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
  thresholdCandidates: Array<{ sku_id: string; suggested_qty: number; reason: string }>;
  boxAdjustments: Array<{ sku_id: string; from_qty: number; to_qty: number; reason: string }>;
  pairSuggestions: Array<{ sku_id: string; suggested_qty: number; reason: string }>;
  template?: DealerSuggestionTemplateEntity;
}) {
  const {
    dealer,
    rules,
    promptConfig,
    cartSummary,
    thresholdCandidates,
    boxAdjustments,
    pairSuggestions,
    template,
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
    "门槛补齐候选（确定性计算结果）：",
    stringify(thresholdCandidates),
    "箱规修正候选（确定性计算结果）：",
    stringify(boxAdjustments),
    "搭配补充候选（确定性计算结果）：",
    stringify(pairSuggestions),
    templateReferenceBlock(template, "box_pair_optimization"),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为：thresholdSuggestion, boxAdjustments, pairSuggestions。",
    "3. 不得修改确定性计算给出的金额、箱规和数量方向，只能组织表达。",
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
  template?: DealerSuggestionTemplateEntity;
}) {
  const { dealer, scene, promptConfig, targetItems, template } = input;
  return [
    `系统角色：${promptConfig.explain_prompt.system_role}`,
    `写作风格：${promptConfig.global_style.tone}`,
    `指令：${promptConfig.explain_prompt.instruction}`,
    `场景：${scene}`,
    "经销商画像：",
    stringify(dealer),
    "目标建议项：",
    stringify(targetItems),
    templateReferenceBlock(template, scene),
    "输出要求：",
    "1. 只返回 JSON 对象，不要 Markdown 代码块，不要额外说明。",
    "2. 对象字段固定为 explanations，每条包含 sku_id 和 explanation。",
    "请输出结构化对象 explanations。",
  ].join("\n\n");
}
