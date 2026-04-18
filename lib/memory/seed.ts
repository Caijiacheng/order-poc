import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  AppMemoryStore,
  CampaignEntity,
  CartSession,
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
    cart_target_amount: globalRules.cart_target_amount,
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

type PurchaseSnapshotItemSeed = Omit<
  RecommendationItemRecord,
  "recommendation_run_id" | "customer_id" | "scene"
>;

type PurchaseSnapshotRunSeed = {
  recommendation_run_id: string;
  batch_id: string;
  trace_id: string;
  customer_id: string;
  customer_name: string;
  scene: "hot_sale_restock" | "stockout_restock" | "campaign_stockup";
  surface: "purchase";
  generation_mode: "precomputed";
  business_date: string;
  snapshot_version: string;
  campaign_id?: string;
  stale_reason?: string;
  strategy_id: string;
  expression_template_id: string;
  prompt_version: string;
  prompt_snapshot: string;
  response_snapshot: string;
  candidate_sku_ids: string[];
  returned_sku_ids: string[];
  cart_amount_before: number;
  cart_amount_after: number;
  model_name: string;
  model_latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  status: RecommendationRunRecord["status"];
  created_at: string;
  updated_at: string;
  items: PurchaseSnapshotItemSeed[];
};

type DerivedPurchaseSeeds = {
  runs: RecommendationRunRecord[];
  items: RecommendationItemRecord[];
  batches: RecommendationBatchRecord[];
};

function derivePurchaseSnapshotSeeds(input: {
  snapshots: PurchaseSnapshotRunSeed[];
  generationJobs: GenerationJobEntity[];
}): DerivedPurchaseSeeds {
  const runs: RecommendationRunRecord[] = input.snapshots.map((record) => ({
    recommendation_run_id: record.recommendation_run_id,
    session_id: `session_purchase_${record.recommendation_run_id}`,
    batch_id: record.batch_id,
    trace_id: record.trace_id,
    customer_id: record.customer_id,
    customer_name: record.customer_name,
    scene: record.scene,
    surface: record.surface,
    generation_mode: record.generation_mode,
    business_date: record.business_date,
    snapshot_version: record.snapshot_version,
    campaign_id: record.campaign_id,
    stale_reason: record.stale_reason,
    page_name: "/purchase",
    trigger_source: "manual",
    strategy_id: record.strategy_id,
    expression_template_id: record.expression_template_id,
    prompt_version: record.prompt_version,
    prompt_snapshot: record.prompt_snapshot,
    response_snapshot: record.response_snapshot,
    candidate_sku_ids: record.candidate_sku_ids,
    returned_sku_ids: record.returned_sku_ids,
    cart_amount_before: record.cart_amount_before,
    cart_amount_after: record.cart_amount_after,
    model_name: record.model_name,
    model_latency_ms: record.model_latency_ms,
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }));

  const items: RecommendationItemRecord[] = input.snapshots.flatMap((record) =>
    record.items.map((item) => ({
      ...item,
      recommendation_run_id: record.recommendation_run_id,
      customer_id: record.customer_id,
      scene: record.scene,
    })),
  );

  const publishedBatchIds = new Set(
    input.generationJobs
      .filter((job) => job.publication_status === "published" && job.published_batch_id)
      .map((job) => job.published_batch_id as string),
  );
  const readyBatchIds = new Set(
    input.generationJobs.flatMap((job) =>
      [job.last_batch_id, job.last_sample_batch_id]
        .filter((batchId): batchId is string => Boolean(batchId))
        .filter((batchId) => !publishedBatchIds.has(batchId)),
    ),
  );

  const byBatch = new Map<string, PurchaseSnapshotRunSeed[]>();
  for (const record of input.snapshots) {
    const current = byBatch.get(record.batch_id) ?? [];
    current.push(record);
    byBatch.set(record.batch_id, current);
  }

  const batches: RecommendationBatchRecord[] = Array.from(byBatch.entries()).map(
    ([batchId, records]) => {
      const sorted = [...records].sort((left, right) =>
        left.created_at.localeCompare(right.created_at),
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const ownerJob = input.generationJobs.find(
        (job) =>
          job.published_batch_id === batchId ||
          job.last_batch_id === batchId ||
          job.last_sample_batch_id === batchId,
      );

      let publicationStatus: RecommendationBatchRecord["publication_status"] = "unpublished";
      if (publishedBatchIds.has(batchId)) {
        publicationStatus = "published";
      } else if (readyBatchIds.has(batchId)) {
        publicationStatus = "ready";
      }

      return {
        batch_id: batchId,
        batch_type: "scheduled_generation",
        trigger_source: "admin",
        job_id: ownerJob?.job_id,
        trace_id: first.trace_id,
        related_run_ids: sorted.map((record) => record.recommendation_run_id),
        config_snapshot_id: "snapshot_seed_default",
        started_at: first.created_at,
        finished_at: last.updated_at,
        status: "success",
        publication_status: publicationStatus,
        fallback_used: false,
        created_at: first.created_at,
        updated_at: last.updated_at,
      };
    },
  );

  return { runs, items, batches };
}

function assertPurchaseSnapshotConsistency(runs: RecommendationRunRecord[]) {
  const purchaseRuns = runs.filter(
    (run) =>
      run.surface === "purchase" &&
      run.generation_mode === "precomputed" &&
      (run.scene === "hot_sale_restock" ||
        run.scene === "stockout_restock" ||
        run.scene === "campaign_stockup"),
  );
  const dealerIds = new Set(purchaseRuns.map((run) => run.customer_id));
  const scenes = new Set(purchaseRuns.map((run) => run.scene));
  if (purchaseRuns.length !== 9 || dealerIds.size !== 3 || scenes.size !== 3) {
    throw new Error(
      "purchase-snapshots.json 必须覆盖 3 个经销商 x 3 个采购场景，共 9 条预计算记录。",
    );
  }
}

function createSeedCheckoutRealtimeRuns(): RecommendationRunRecord[] {
  return [
    {
      recommendation_run_id: "reco_run_seed_002",
      session_id: "session_seed_002",
      trace_id: "trace_checkout_seed_001",
      customer_id: "dealer_cd_pf",
      customer_name: "成都餐饮批发经销商",
      scene: "checkout_optimization",
      surface: "checkout",
      generation_mode: "realtime",
      business_date: "2026-04-15",
      snapshot_version: "realtime_seed_v1",
      page_name: "/order-submit",
      trigger_source: "assistant",
      strategy_id: "tpl_checkout_default",
      expression_template_id: "expr_cart_opt_default",
      prompt_version: "2026.04.15.realtime.seed",
      prompt_snapshot: [
        "系统角色：你是结算页凑单优化助手。",
        "场景：checkout_optimization",
        "目标：按规则给出可执行凑单建议。",
      ].join("\n"),
      response_snapshot: JSON.stringify(
        {
          decisions: [
            {
              bar_type: "threshold",
              combo_id: "checkout_seed_combo_1",
              explanation: "补齐后可达起订门槛，并保持常购结构稳定。",
            },
          ],
        },
        null,
        2,
      ),
      candidate_sku_ids: ["cb_oyster_big_2270", "cb_chicken_restaurant_1kg"],
      returned_sku_ids: ["cb_oyster_big_2270"],
      cart_amount_before: 978,
      cart_amount_after: 1102,
      model_name: "seed-mock-model",
      model_latency_ms: 1066,
      input_tokens: 901,
      output_tokens: 244,
      status: "fully_applied",
      created_at: "2026-04-15T01:20:00.000Z",
      updated_at: "2026-04-15T01:23:00.000Z",
    },
  ];
}

function createSeedCheckoutRealtimeItems(): RecommendationItemRecord[] {
  return [
    {
      recommendation_item_id: "reco_item_checkout_seed_001",
      recommendation_run_id: "reco_run_seed_002",
      customer_id: "dealer_cd_pf",
      scene: "checkout_optimization",
      sku_id: "cb_oyster_big_2270",
      sku_name: "厨邦大包装蚝油",
      suggested_qty: 4,
      suggested_rank: 1,
      reason: "补齐整箱数量后可同时满足门槛与配送效率。",
      reason_tags: ["门槛补差", "箱规修正"],
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
  ];
}

function createSeedEvents(input: {
  purchaseRuns: RecommendationRunRecord[];
  checkoutRuns: RecommendationRunRecord[];
}): MetricEvent[] {
  const firstPurchaseRun = input.purchaseRuns[0];
  const firstCheckoutRun = input.checkoutRuns[0];

  return [
    {
      id: randomUUID(),
      timestamp: firstPurchaseRun?.created_at ?? "2026-04-15T01:10:00.000Z",
      customerId: firstPurchaseRun?.customer_id ?? "dealer_xm_sm",
      customerName: firstPurchaseRun?.customer_name ?? "厦门思明经销商",
      eventType: "recommendation_generated",
      scene: firstPurchaseRun?.scene ?? "hot_sale_restock",
      payload: {
        recommendation_run_id:
          firstPurchaseRun?.recommendation_run_id ?? "reco_run_seed_fallback_001",
        batch_id: firstPurchaseRun?.batch_id ?? "batch_seed_001",
      },
    },
    {
      id: randomUUID(),
      timestamp: firstCheckoutRun?.created_at ?? "2026-04-15T01:20:00.000Z",
      customerId: firstCheckoutRun?.customer_id ?? "dealer_cd_pf",
      customerName: firstCheckoutRun?.customer_name ?? "成都餐饮批发经销商",
      eventType: "cart_optimized",
      scene: firstCheckoutRun?.scene ?? "checkout_optimization",
      payload: {
        recommendation_run_id:
          firstCheckoutRun?.recommendation_run_id ?? "reco_run_seed_002",
      },
    },
  ];
}

function createSeedCartSessions(thresholdAmount: number): Record<string, CartSession> {
  const seedItems = [
    {
      sku_id: "cb_oyster_big_2270",
      sku_name: "厨邦大包装蚝油",
      qty: 2,
      price_per_case: 186,
      box_multiple: 4,
      source: "manual" as const,
      added_at: "2026-04-15T01:18:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
    {
      sku_id: "cb_chicken_powder_combo",
      sku_name: "厨邦鸡粉组合装",
      qty: 3,
      price_per_case: 208,
      box_multiple: 6,
      source: "manual" as const,
      added_at: "2026-04-15T01:18:00.000Z",
      updated_at: "2026-04-15T01:18:00.000Z",
    },
  ];
  const totalAmount = seedItems.reduce(
    (sum, item) => sum + item.qty * item.price_per_case,
    0,
  );

  return {
    session_seed_002: {
      session_id: "session_seed_002",
      customer_id: "dealer_cd_pf",
      items: seedItems,
      summary: {
        item_count: seedItems.reduce((sum, item) => sum + item.qty, 0),
        sku_count: seedItems.length,
        total_amount: totalAmount,
        threshold_amount: thresholdAmount,
        gap_to_threshold: Math.max(0, thresholdAmount - totalAmount),
        threshold_reached: totalAmount >= thresholdAmount,
      },
      submitted_orders: [],
      created_at: "2026-04-15T01:18:00.000Z",
      updated_at: "2026-04-15T01:23:00.000Z",
    },
  };
}

function createSeedGenerationJobs(): GenerationJobEntity[] {
  return [
    {
      job_id: "job_seed_2026-04-15",
      job_name: "2026-04-15 每日建议单生成",
      business_date: "2026-04-15",
      target_dealer_ids: ["dealer_xm_sm", "dealer_dg_sm", "dealer_cd_pf"],
      target_segment_ids: [],
      strategy_ids: ["tpl_purchase_stockout", "tpl_purchase_hot_sale", "tpl_purchase_campaign"],
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
  const purchaseSnapshots = loadJsonFile<PurchaseSnapshotRunSeed[]>(
    "purchase-snapshots.json",
  );
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

  const normalizedGenerationJobs = generationJobs.map(normalizeGenerationJob);
  const purchaseSeeds = derivePurchaseSnapshotSeeds({
    snapshots: purchaseSnapshots,
    generationJobs: normalizedGenerationJobs,
  });
  assertPurchaseSnapshotConsistency(purchaseSeeds.runs);

  const checkoutRuns = createSeedCheckoutRealtimeRuns();
  const checkoutItems = createSeedCheckoutRealtimeItems();

  const recommendationRuns = [...purchaseSeeds.runs, ...checkoutRuns].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  const recommendationItems = [...purchaseSeeds.items, ...checkoutItems].sort(
    (left, right) => right.created_at.localeCompare(left.created_at),
  );
  const recommendationBatches = [...purchaseSeeds.batches].sort(
    (left, right) => right.created_at.localeCompare(left.created_at),
  );

  const promptConfig = toPromptConfig(expressionTemplates);
  const rules = toRuleConfig(globalRules);

  const latestEvents = createSeedEvents({
    purchaseRuns: purchaseSeeds.runs,
    checkoutRuns,
  });

  const customerSceneBreakdown = recommendationRuns.reduce<Record<string, number>>(
    (acc, run) => {
      const key = `${run.customer_id}_${run.scene}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const totalCartAmountBefore = recommendationRuns.reduce(
    (sum, run) => sum + (run.cart_amount_before ?? 0),
    0,
  );
  const totalCartAmountAfter = recommendationRuns.reduce(
    (sum, run) => sum + (run.cart_amount_after ?? 0),
    0,
  );
  const totalModelLatencyMs = recommendationRuns.reduce(
    (sum, run) => sum + run.model_latency_ms,
    0,
  );
  const totalInputTokens = recommendationRuns.reduce(
    (sum, run) => sum + (run.input_tokens ?? 0),
    0,
  );
  const totalOutputTokens = recommendationRuns.reduce(
    (sum, run) => sum + (run.output_tokens ?? 0),
    0,
  );
  const purchaseRequestCount = recommendationRuns.filter(
    (run) =>
      run.surface === "purchase" &&
      (run.scene === "hot_sale_restock" ||
        run.scene === "stockout_restock" ||
        run.scene === "campaign_stockup"),
  ).length;
  const campaignRequestCount = recommendationRuns.filter(
    (run) => run.scene === "campaign_stockup",
  ).length;
  const checkoutRequestCount = recommendationRuns.filter(
    (run) => run.scene === "checkout_optimization",
  ).length;
  const appliedItemCount = recommendationItems.filter(
    (item) => item.final_status === "applied" || item.final_status === "submitted_with_order",
  ).length;

  const metrics = {
    sessionCount: recommendationRuns.length,
    recommendationRequests: purchaseRequestCount,
    weeklyFocusRequests: campaignRequestCount,
    cartOptimizationRequests: checkoutRequestCount,
    explanationRequests: 12,
    addToCartFromSuggestion: appliedItemCount,
    applyOptimizationCount: checkoutRequestCount,
    thresholdReachedCount: checkoutRequestCount,
    boxAdjustmentCount: checkoutRequestCount,
    pairSuggestionAppliedCount: Math.max(0, appliedItemCount - checkoutRequestCount),
    totalCartAmountBefore,
    totalCartAmountAfter,
    totalRevenueLift: Math.max(0, totalCartAmountAfter - totalCartAmountBefore),
    averageModelLatencyMs:
      recommendationRuns.length > 0
        ? Math.round(totalModelLatencyMs / recommendationRuns.length)
        : 0,
    totalModelCalls: recommendationRuns.length,
    totalInputTokens,
    totalOutputTokens,
    structuredOutputFailureCount: 0,
    customerSceneBreakdown,
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
    generationJobs: normalizedGenerationJobs,
    recommendationBatches: recommendationBatches.map(normalizeRecommendationBatch),
    recoverySnapshots,
    uiConfig,
    metrics,
    recommendationRuns,
    recommendationItems,
    cartSessions: createSeedCartSessions(rules.threshold_amount),
    auditLogs: [],
    rules,
    promptConfig,
  };
}
