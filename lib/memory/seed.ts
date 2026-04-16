import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  AppMemoryStore,
  CampaignEntity,
  DealerEntity,
  DealerSuggestionTemplateEntity,
  MetricEvent,
  ProductEntity,
  PromptConfigEntity,
  RecommendationItemRecord,
  RecommendationRunRecord,
  RuleConfigEntity,
  UIConfigEntity,
} from "@/lib/memory/types";

function loadJsonFile<T>(filename: string): T {
  const fullPath = path.join(process.cwd(), "data", filename);
  const raw = readFileSync(fullPath, "utf-8");
  return JSON.parse(raw) as T;
}

function createSeedEvents(): MetricEvent[] {
  return [
    {
      id: randomUUID(),
      timestamp: "2026-04-15T01:10:00.000Z",
      customerId: "dealer_xm_sm",
      customerName: "厦门思明经销商",
      eventType: "recommendation_generated",
      scene: "daily_recommendation",
      payload: { recommendation_run_id: "reco_run_seed_001" },
    },
    {
      id: randomUUID(),
      timestamp: "2026-04-15T01:20:00.000Z",
      customerId: "dealer_cd_pf",
      customerName: "成都餐饮批发经销商",
      eventType: "cart_optimized",
      scene: "box_pair_optimization",
      payload: { recommendation_run_id: "reco_run_seed_002" },
    },
  ];
}

function createSeedRecommendationRuns(): RecommendationRunRecord[] {
  return [
    {
      recommendation_run_id: "reco_run_seed_001",
      session_id: "session_seed_001",
      trace_id: "trace_seed_001",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "daily_recommendation",
      page_name: "/procurement",
      trigger_source: "manual",
      template_id: "tpl_xm_daily",
      template_name: "厦门日常补货建议",
      prompt_version: "2026.04.15.a",
      prompt_snapshot: "seed prompt snapshot for xm daily recommendation",
      candidate_sku_ids: [
        "cb_weijixian_500",
        "cb_oyster_700",
        "cb_chicken_essence_200",
      ],
      returned_sku_ids: ["cb_weijixian_500", "cb_oyster_700"],
      cart_amount_before: 724,
      cart_amount_after: 843,
      model_name: "seed-mock-model",
      model_latency_ms: 820,
      input_tokens: 820,
      output_tokens: 248,
      status: "partially_applied",
      created_at: "2026-04-15T01:10:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
    {
      recommendation_run_id: "reco_run_seed_002",
      session_id: "session_seed_002",
      trace_id: "trace_seed_002",
      customer_id: "dealer_cd_pf",
      customer_name: "成都餐饮批发经销商",
      scene: "box_pair_optimization",
      page_name: "/basket",
      trigger_source: "assistant",
      template_id: "tpl_cd_boxpair",
      template_name: "成都箱规与搭配优化",
      prompt_version: "2026.04.15.a",
      prompt_snapshot: "seed prompt snapshot for cd cart optimization",
      candidate_sku_ids: ["cb_oyster_big_2270", "cb_chicken_restaurant_1kg"],
      returned_sku_ids: ["cb_oyster_big_2270", "cb_chicken_restaurant_1kg"],
      cart_amount_before: 978,
      cart_amount_after: 1032,
      model_name: "seed-mock-model",
      model_latency_ms: 1104,
      input_tokens: 930,
      output_tokens: 291,
      status: "fully_applied",
      created_at: "2026-04-15T01:20:00.000Z",
      updated_at: "2026-04-15T01:23:00.000Z",
    },
  ];
}

function createSeedRecommendationItems(): RecommendationItemRecord[] {
  return [
    {
      recommendation_item_id: "reco_item_seed_001",
      recommendation_run_id: "reco_run_seed_001",
      customer_id: "dealer_xm_sm",
      scene: "daily_recommendation",
      sku_id: "cb_weijixian_500",
      sku_name: "厨邦味极鲜特级生抽",
      suggested_qty: 12,
      suggested_rank: 1,
      reason: "进入补货周期且为高频动销品。",
      reason_tags: ["常购品", "补货周期"],
      action_type: "add_to_cart",
      effect_type: "replenishment",
      was_viewed: true,
      was_explained: true,
      was_applied: true,
      applied_qty: 12,
      applied_at: "2026-04-15T01:14:00.000Z",
      applied_by: "user",
      order_submitted_with_item: false,
      final_status: "applied",
      created_at: "2026-04-15T01:10:00.000Z",
      updated_at: "2026-04-15T01:14:00.000Z",
    },
    {
      recommendation_item_id: "reco_item_seed_002",
      recommendation_run_id: "reco_run_seed_001",
      customer_id: "dealer_xm_sm",
      scene: "daily_recommendation",
      sku_id: "cb_oyster_700",
      sku_name: "厨邦蚝油",
      suggested_qty: 8,
      suggested_rank: 2,
      reason: "与鸡精组合动销表现稳定。",
      reason_tags: ["搭配品"],
      action_type: "add_to_cart",
      effect_type: "pair_item",
      was_viewed: true,
      was_explained: false,
      was_applied: false,
      applied_by: "unknown",
      final_status: "pending",
      created_at: "2026-04-15T01:10:00.000Z",
      updated_at: "2026-04-15T01:10:00.000Z",
    },
    {
      recommendation_item_id: "reco_item_seed_003",
      recommendation_run_id: "reco_run_seed_002",
      customer_id: "dealer_cd_pf",
      scene: "box_pair_optimization",
      sku_id: "cb_oyster_big_2270",
      sku_name: "厨邦大包装蚝油",
      suggested_qty: 4,
      suggested_rank: 1,
      reason: "整箱采购更贴合批发配送节奏。",
      reason_tags: ["箱规修正"],
      action_type: "adjust_qty",
      effect_type: "box_adjustment",
      was_viewed: true,
      was_explained: true,
      was_applied: true,
      applied_qty: 4,
      applied_at: "2026-04-15T01:22:00.000Z",
      applied_by: "system",
      order_submitted_with_item: false,
      final_status: "applied",
      created_at: "2026-04-15T01:20:00.000Z",
      updated_at: "2026-04-15T01:22:00.000Z",
    },
    {
      recommendation_item_id: "reco_item_seed_004",
      recommendation_run_id: "reco_run_seed_002",
      customer_id: "dealer_cd_pf",
      scene: "box_pair_optimization",
      sku_id: "cb_chicken_restaurant_1kg",
      sku_name: "厨邦餐饮装鸡精",
      suggested_qty: 6,
      suggested_rank: 2,
      reason: "搭配蚝油可形成完整餐饮调味组合。",
      reason_tags: ["搭配补充"],
      action_type: "add_to_cart",
      effect_type: "pair_item",
      was_viewed: true,
      was_explained: false,
      was_applied: true,
      applied_qty: 6,
      applied_at: "2026-04-15T01:23:00.000Z",
      applied_by: "user",
      order_submitted_with_item: false,
      final_status: "applied",
      created_at: "2026-04-15T01:20:00.000Z",
      updated_at: "2026-04-15T01:23:00.000Z",
    },
  ];
}

export function loadSeedStore(): AppMemoryStore {
  const products = loadJsonFile<ProductEntity[]>("products.json");
  const dealers = loadJsonFile<DealerEntity[]>("dealers.json");
  const campaigns = loadJsonFile<CampaignEntity[]>("campaigns.json");
  const suggestionTemplates = loadJsonFile<DealerSuggestionTemplateEntity[]>(
    "suggestion-templates.json",
  );
  const rules = loadJsonFile<RuleConfigEntity>("rules.json");
  const promptConfig = loadJsonFile<PromptConfigEntity>("prompt-config.json");
  const uiConfig = loadJsonFile<UIConfigEntity>("ui-config.json");

  const recommendationRuns = createSeedRecommendationRuns();
  const recommendationItems = createSeedRecommendationItems();
  const latestEvents = createSeedEvents();

  const metrics = {
    sessionCount: 9,
    recommendationRequests: 28,
    weeklyFocusRequests: 11,
    cartOptimizationRequests: 18,
    explanationRequests: 12,
    addToCartFromSuggestion: 21,
    applyOptimizationCount: 17,
    thresholdReachedCount: 9,
    boxAdjustmentCount: 8,
    pairSuggestionAppliedCount: 11,
    totalCartAmountBefore: 6924,
    totalCartAmountAfter: 7711,
    totalRevenueLift: 787,
    averageModelLatencyMs: 941,
    totalModelCalls: 57,
    totalInputTokens: 48760,
    totalOutputTokens: 13350,
    structuredOutputFailureCount: 0,
    customerSceneBreakdown: {
      dealer_xm_sm_daily_recommendation: 11,
      dealer_dg_sm_weekly_focus: 7,
      dealer_cd_pf_box_pair_optimization: 10,
    },
    latestEvents,
  };

  return {
    products,
    dealers,
    suggestionTemplates,
    campaigns,
    rules,
    promptConfig,
    uiConfig,
    metrics,
    recommendationRuns,
    recommendationItems,
    cartSessions: {},
    auditLogs: [],
  };
}
