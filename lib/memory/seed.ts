import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  AppMemoryStore,
  CampaignEntity,
  DealerEntity,
  DealerSegmentEntity,
  ExpressionTemplateEntity,
  GenerationJobEntity,
  GlobalRuleEntity,
  MetricEvent,
  ProductEntity,
  ProductPoolEntity,
  PromptConfigEntity,
  RecommendationBatchRecord,
  RecommendationItemRecord,
  RecommendationRunRecord,
  RecommendationStrategyEntity,
  RecoverySnapshotRecord,
  RuleConfigEntity,
  UIConfigEntity,
} from "@/lib/memory/types";

function loadJsonFile<T>(filename: string): T {
  const fullPath = path.join(process.cwd(), "data", filename);
  const raw = readFileSync(fullPath, "utf-8");
  return JSON.parse(raw) as T;
}

function loadJsonFileOptional<T>(filename: string): T | null {
  const fullPath = path.join(process.cwd(), "data", filename);
  if (!existsSync(fullPath)) {
    return null;
  }
  const raw = readFileSync(fullPath, "utf-8");
  return JSON.parse(raw) as T;
}

function toRuleConfig(globalRules: GlobalRuleEntity): RuleConfigEntity {
  return {
    replenishment_days_threshold: globalRules.replenishment_days_threshold,
    cart_gap_trigger_amount: globalRules.cart_gap_trigger_amount,
    threshold_amount: globalRules.threshold_amount,
    prefer_frequent_items: globalRules.prefer_frequent_items,
    prefer_pair_items: globalRules.prefer_pair_items,
    box_adjust_if_close: globalRules.box_adjust_if_close,
    box_adjust_distance_limit: globalRules.box_adjust_distance_limit,
    allow_new_product_recommendation: globalRules.allow_new_product_recommendation,
  };
}

function toPromptConfig(templates: ExpressionTemplateEntity[]): PromptConfigEntity {
  const pickTemplate = (type: ExpressionTemplateEntity["template_type"]) =>
    templates.find((item) => item.template_type === type && item.status === "active");

  const bundle = pickTemplate("bundle_explanation");
  const topup = pickTemplate("topup_explanation");
  const shared = bundle ?? topup;

  return {
    global_style: {
      tone: shared?.tone ?? "专业、简洁、面向执行",
      avoid: shared?.avoid ?? [],
      reason_limit: shared?.reason_limit ?? 3,
    },
    recommendation_prompt: {
      system_role: bundle?.system_role ?? "",
      instruction: bundle?.instruction ?? "",
    },
    cart_opt_prompt: {
      system_role: topup?.system_role ?? bundle?.system_role ?? "",
      instruction: topup?.instruction ?? bundle?.instruction ?? "",
    },
    explain_prompt: {
      system_role: bundle?.system_role ?? topup?.system_role ?? "",
      instruction: bundle?.instruction ?? topup?.instruction ?? "",
    },
  };
}

function deriveSegments(dealers: DealerEntity[]): DealerSegmentEntity[] {
  const map = new Map<string, DealerSegmentEntity>();
  const now = "2026-04-01T08:00:00.000Z";

  for (const dealer of dealers) {
    const key = `${dealer.customer_type}::${dealer.channel_type}`;
    const existing = map.get(key);
    if (existing) {
      existing.city_list = Array.from(new Set([...existing.city_list, dealer.city]));
      existing.dealer_ids = Array.from(
        new Set([...existing.dealer_ids, dealer.customer_id]),
      );
      continue;
    }

    map.set(key, {
      segment_id: `seg_${dealer.customer_type
        .replace(/\s+/g, "_")
        .replace(/[^\w\u4e00-\u9fa5]/g, "")
        .toLowerCase()}_${dealer.channel_type
        .replace(/\s+/g, "_")
        .replace(/[^\w\u4e00-\u9fa5]/g, "")
        .toLowerCase()}`,
      segment_name: `${dealer.customer_type}·${dealer.channel_type}`,
      description: `按客户类型 ${dealer.customer_type} 和渠道 ${dealer.channel_type} 归类`,
      city_list: [dealer.city],
      customer_types: [dealer.customer_type],
      channel_types: [dealer.channel_type],
      dealer_ids: [dealer.customer_id],
      status: "active",
      created_at: now,
      updated_at: now,
    });
  }

  return Array.from(map.values());
}

function deriveProductPools(products: ProductEntity[]): ProductPoolEntity[] {
  const now = "2026-04-01T08:00:00.000Z";
  const activeProducts = products.filter((item) => item.status === "active");
  const byTag = (tag: string) =>
    activeProducts
      .filter((item) => item.tags.includes(tag))
      .map((item) => item.sku_id);

  return [
    {
      pool_id: "pool_regular_replenishment",
      pool_name: "常规补货池",
      pool_type: "regular",
      description: "日常补货高频 SKU",
      sku_ids: activeProducts
        .filter((item) => item.tags.includes("常购"))
        .map((item) => item.sku_id),
      pair_sku_ids: [],
      status: "active",
      created_at: now,
      updated_at: now,
    },
    {
      pool_id: "pool_hot_sale",
      pool_name: "热销商品池",
      pool_type: "hot_sale",
      description: "动销快、优先保障供货的商品池",
      sku_ids: byTag("高频动销"),
      pair_sku_ids: [],
      status: "active",
      created_at: now,
      updated_at: now,
    },
    {
      pool_id: "pool_new_product",
      pool_name: "新品商品池",
      pool_type: "new_product",
      description: "用于新品试销场景",
      sku_ids: activeProducts
        .filter((item) => item.is_new_product)
        .map((item) => item.sku_id),
      pair_sku_ids: [],
      status: "active",
      created_at: now,
      updated_at: now,
    },
    {
      pool_id: "pool_pairing",
      pool_name: "搭配关系池",
      pool_type: "pairing",
      description: "用于凑单搭配补充场景",
      sku_ids: activeProducts.map((item) => item.sku_id),
      pair_sku_ids: activeProducts.flatMap((item) => item.pair_items),
      status: "active",
      created_at: now,
      updated_at: now,
    },
  ];
}

function createSeedRecommendationRuns(): RecommendationRunRecord[] {
  return [
    {
      recommendation_run_id: "reco_run_seed_001",
      session_id: "session_seed_001",
      batch_id: "batch_seed_001",
      trace_id: "trace_seed_001",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "daily_recommendation",
      page_name: "/purchase",
      trigger_source: "manual",
      strategy_id: "tpl_xm_daily",
      expression_template_id: "expr_recommendation_default",
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
      batch_id: "batch_seed_002",
      trace_id: "trace_seed_002",
      customer_id: "dealer_cd_pf",
      customer_name: "成都餐饮批发经销商",
      scene: "box_pair_optimization",
      page_name: "/order-submit",
      trigger_source: "assistant",
      strategy_id: "tpl_cd_boxpair",
      expression_template_id: "expr_cart_opt_default",
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
    {
      recommendation_run_id: "reco_run_seed_003",
      session_id: "session_seed_003",
      batch_id: "batch_seed_001",
      trace_id: "trace_seed_003",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "weekly_focus",
      page_name: "/purchase",
      trigger_source: "manual",
      strategy_id: "tpl_xm_daily",
      expression_template_id: "expr_recommendation_default",
      prompt_version: "2026.04.15.a",
      prompt_snapshot: "seed prompt snapshot for xm weekly focus",
      candidate_sku_ids: ["cb_zeroadd_shengchou_500", "cb_zeroadd_head_500"],
      returned_sku_ids: ["cb_zeroadd_shengchou_500"],
      cart_amount_before: 843,
      cart_amount_after: 1039,
      model_name: "seed-mock-model",
      model_latency_ms: 904,
      input_tokens: 762,
      output_tokens: 226,
      status: "generated",
      created_at: "2026-04-15T01:11:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
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
    {
      recommendation_item_id: "reco_item_seed_005",
      recommendation_run_id: "reco_run_seed_003",
      customer_id: "dealer_xm_sm",
      scene: "weekly_focus",
      sku_id: "cb_zeroadd_shengchou_500",
      sku_name: "厨邦零添加特级生抽",
      suggested_qty: 12,
      suggested_rank: 1,
      reason: "本周活动主推商品，建议提前备货。",
      reason_tags: ["活动备货", "新品试销"],
      action_type: "add_to_cart",
      effect_type: "weekly_focus",
      was_viewed: true,
      was_explained: false,
      was_applied: true,
      applied_qty: 12,
      applied_at: "2026-04-15T01:18:00.000Z",
      applied_by: "user",
      final_status: "applied",
      created_at: "2026-04-15T01:11:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
  ];
}

function createSeedRecommendationBatches(): RecommendationBatchRecord[] {
  return [
    {
      batch_id: "batch_seed_001",
      batch_type: "scheduled_generation",
      trigger_source: "admin",
      job_id: "job_seed_2026-04-15",
      customer_id: "dealer_xm_sm",
      scene: "daily_recommendation",
      trace_id: "trace_seed_001",
      related_run_ids: ["reco_run_seed_001", "reco_run_seed_003"],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-15T01:08:00.000Z",
      finished_at: "2026-04-15T01:18:00.000Z",
      status: "success",
      publication_status: "published",
      fallback_used: false,
      created_at: "2026-04-15T01:08:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
    {
      batch_id: "batch_seed_002",
      batch_type: "frontstage_realtime",
      trigger_source: "frontstage",
      session_id: "session_seed_002",
      customer_id: "dealer_cd_pf",
      scene: "box_pair_optimization",
      trace_id: "trace_seed_002",
      related_run_ids: ["reco_run_seed_002"],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-15T01:20:00.000Z",
      finished_at: "2026-04-15T01:23:00.000Z",
      status: "success",
      publication_status: "unpublished",
      fallback_used: false,
      created_at: "2026-04-15T01:20:00.000Z",
      updated_at: "2026-04-15T01:23:00.000Z",
    },
  ];
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
      payload: {
        recommendation_run_id: "reco_run_seed_001",
        batch_id: "batch_seed_001",
      },
    },
    {
      id: randomUUID(),
      timestamp: "2026-04-15T01:20:00.000Z",
      customerId: "dealer_cd_pf",
      customerName: "成都餐饮批发经销商",
      eventType: "recommendation_batch_created",
      scene: "box_pair_optimization",
      payload: {
        recommendation_run_id: "reco_run_seed_002",
        batch_id: "batch_seed_002",
      },
    },
  ];
}

function createSeedGenerationJobs(): GenerationJobEntity[] {
  return [
    {
      job_id: "job_seed_2026-04-15",
      job_name: "2026-04-15 每日建议单生成",
      business_date: "2026-04-15",
      target_dealer_ids: ["dealer_xm_sm", "dealer_dg_sm", "dealer_cd_pf"],
      target_segment_ids: [],
      strategy_ids: ["tpl_xm_daily", "tpl_dg_daily", "tpl_cd_boxpair"],
      publish_mode: "manual",
      status: "completed",
      publication_status: "published",
      precheck_summary: "seed 预检通过",
      last_precheck_at: "2026-04-15T01:00:00.000Z",
      last_sample_batch_id: "batch_seed_001",
      last_batch_id: "batch_seed_001",
      published_batch_id: "batch_seed_001",
      published_at: "2026-04-15T01:18:00.000Z",
      created_at: "2026-04-15T00:58:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
  ];
}

function normalizeGenerationJob(input: GenerationJobEntity): GenerationJobEntity {
  return {
    ...input,
    publication_status:
      input.publication_status ??
      (input.published_batch_id ? "published" : input.last_batch_id ? "ready" : "unpublished"),
    last_precheck_at: input.last_precheck_at,
    last_sample_batch_id: input.last_sample_batch_id,
    published_batch_id: input.published_batch_id,
    published_at: input.published_at,
  };
}

function normalizeRecommendationBatch(
  input: RecommendationBatchRecord,
): RecommendationBatchRecord {
  return {
    ...input,
    job_id: input.job_id,
    publication_status: input.publication_status ?? "unpublished",
  };
}

function createSeedRecoverySnapshots(): RecoverySnapshotRecord[] {
  return [
    {
      snapshot_id: "snapshot_seed_default",
      snapshot_name: "Seed Baseline",
      source: "seed",
      description: "应用启动默认基线快照",
      config_snapshot_id: "cfg_seed_default",
      related_entity_types: [
        "products",
        "dealers",
        "dealer_segments",
        "product_pools",
        "recommendation_strategies",
        "expression_templates",
        "global_rules",
      ],
      status: "available",
      created_by: "system",
      created_at: "2026-04-01T08:00:00.000Z",
      updated_at: "2026-04-01T08:00:00.000Z",
    },
  ];
}

export function loadSeedStore(): AppMemoryStore {
  const products = loadJsonFile<ProductEntity[]>("products.json");
  const dealers = loadJsonFile<DealerEntity[]>("dealers.json");
  const campaigns = loadJsonFile<CampaignEntity[]>("campaigns.json");
  const recommendationStrategies = loadJsonFile<RecommendationStrategyEntity[]>(
    "recommendation-strategies.json",
  );
  const expressionTemplates = loadJsonFile<ExpressionTemplateEntity[]>(
    "expression-templates.json",
  );
  const globalRules = loadJsonFile<GlobalRuleEntity>("global-rules.json");
  const generationJobs =
    loadJsonFileOptional<GenerationJobEntity[]>("generation-jobs.json") ??
    createSeedGenerationJobs();
  const recommendationBatches =
    loadJsonFileOptional<RecommendationBatchRecord[]>("recommendation-batches.json") ??
    createSeedRecommendationBatches();
  const recoverySnapshots =
    loadJsonFileOptional<RecoverySnapshotRecord[]>("recovery-snapshots.json") ??
    createSeedRecoverySnapshots();
  const uiConfig = loadJsonFile<UIConfigEntity>("ui-config.json");

  const dealerSegments =
    loadJsonFileOptional<DealerSegmentEntity[]>("dealer-segments.json") ??
    deriveSegments(dealers);
  const productPools =
    loadJsonFileOptional<ProductPoolEntity[]>("product-pools.json") ??
    deriveProductPools(products);

  const recommendationRuns = createSeedRecommendationRuns();
  const recommendationItems = createSeedRecommendationItems();
  const promptConfig = toPromptConfig(expressionTemplates);
  const rules = toRuleConfig(globalRules);

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
    dealerSegments,
    productPools,
    recommendationStrategies,
    expressionTemplates,
    campaigns,
    globalRules,
    generationJobs: generationJobs.map(normalizeGenerationJob),
    recommendationBatches: recommendationBatches.map(normalizeRecommendationBatch),
    recoverySnapshots,
    uiConfig,
    metrics,
    recommendationRuns,
    recommendationItems,
    cartSessions: {},
    auditLogs: [],
    rules,
    promptConfig,
  };
}
