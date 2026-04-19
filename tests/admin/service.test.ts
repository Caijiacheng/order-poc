import { beforeEach, describe, expect, it } from "vitest";

import {
  AdminServiceError,
  applyRecoverySnapshot,
  archiveRecoverySnapshot,
  cancelGenerationJob,
  createCampaign,
  createDealerSegment,
  createExpressionTemplate,
  createGenerationJob,
  createProductPool,
  createRecommendationBatch,
  createRecommendationStrategy,
  createRecoverySnapshot,
  getExpressionTemplateById,
  getGlobalRules,
  getPublishedSuggestionsForCustomer,
  getRecommendationRecordDetail,
  getRecoverySnapshotById,
  listGenerationJobs,
  listRecommendationBatches,
  listRecommendationRecords,
  listRecommendationStrategies,
  listExpressionTemplates,
  precheckGenerationJob,
  publishGenerationJob,
  replayGenerationJob,
  replayRecommendationRecord,
  resetDemoData,
  softDeleteExpressionTemplate,
  updateCampaign,
  updateGenerationJob,
  updateExpressionTemplate,
  updateGlobalRules,
} from "../../lib/admin/service";
import type { ListQuery } from "../../lib/admin/list-query";
import { validateCampaignInput } from "../../lib/admin/validation";
import {
  generateCartOptimizationForSession,
  generateRecommendationsForCustomer,
} from "../../lib/domain/business-service";
import { matchCampaignsForDealer } from "../../lib/domain/recommendation-rules";
import { getMemoryStore } from "../../lib/memory/store";
import {
  captureLlmEnv,
  resetRuntimeState,
  restoreLlmEnv,
  setMockLlmEnv,
} from "../helpers/runtime";

const LIST_QUERY: ListQuery = {
  page: 1,
  pageSize: 200,
  q: "",
  status: "",
  sortBy: "display_order",
  sortOrder: "asc",
};

const REPORT_QUERY: ListQuery = {
  ...LIST_QUERY,
  sortBy: "created_at",
  sortOrder: "desc",
};

describe("admin service Stage 2 contracts", () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it("validates and persists new segment / pool / strategy / expression-template contracts", () => {
    expect(() =>
      createDealerSegment({
        segment_id: "seg_stage2_invalid",
        segment_name: "stage2 invalid",
        description: "invalid segment",
        city_list: ["厦门"],
        customer_types: ["城区核心客户"],
        channel_types: ["餐饮+流通"],
        dealer_ids: ["dealer_not_exist"],
        status: "active",
      }),
    ).toThrowError(AdminServiceError);

    const segment = createDealerSegment({
      segment_id: "seg_stage2_new",
      segment_name: "Stage2 新分群",
      description: "用于 Stage2 契约测试",
      city_list: ["厦门"],
      customer_types: ["城区核心客户"],
      channel_types: ["餐饮+流通"],
      dealer_ids: ["dealer_xm_sm"],
      status: "active",
    });
    expect(segment.segment_id).toBe("seg_stage2_new");

    const pool = createProductPool({
      pool_id: "pool_stage2_new",
      pool_name: "Stage2 测试商品池",
      pool_type: "regular",
      description: "用于 Stage2 契约测试",
      sku_ids: ["cb_weijixian_500", "cb_oyster_700"],
      pair_sku_ids: ["cb_chicken_essence_200"],
      status: "active",
    });
    expect(pool.pool_id).toBe("pool_stage2_new");

    const expressionTemplate = createExpressionTemplate({
      expression_template_id: "expr_stage2_new",
      expression_template_name: "Stage2 表达模板",
      template_type: "bundle_explanation",
      scene: "bundle",
      tone: "清晰可执行",
      avoid: ["空泛建议"],
      reason_limit: 2,
      system_role: "stage2 role",
      instruction: "stage2 instruction",
      style_hint: "stage2 hint",
      status: "active",
    });
    expect(expressionTemplate.expression_template_id).toBe("expr_stage2_new");

    const strategy = createRecommendationStrategy({
      strategy_id: "stg_stage2_new",
      strategy_name: "Stage2 推荐策略",
      scene: "hot_sale_restock",
      target_dealer_ids: ["dealer_xm_sm"],
      dealer_segment_ids: ["seg_stage2_new"],
      product_pool_ids: ["pool_stage2_new"],
      campaign_ids: [],
      candidate_sku_ids: ["cb_weijixian_500"],
      reference_items: [
        {
          sku_id: "cb_weijixian_500",
          qty: 2,
          reason: "stage2 strategy reason",
          reason_tags: ["stage2"],
          sort_order: 1,
        },
      ],
      business_notes: "stage2 notes",
      expression_template_id: "expr_stage2_new",
      priority: 11,
      status: "active",
    });
    expect(strategy.strategy_id).toBe("stg_stage2_new");

    const strategyIds = new Set(
      listRecommendationStrategies(LIST_QUERY).items.map((item) => item.strategy_id),
    );
    expect(strategyIds.has("stg_stage2_new")).toBe(true);

    updateExpressionTemplate("expr_stage2_new", {
      expression_template_name: "Stage2 表达模板(更新)",
      reason_limit: 4,
    });
    expect(getExpressionTemplateById("expr_stage2_new")?.reason_limit).toBe(4);

    const deletedExpressionTemplate = softDeleteExpressionTemplate("expr_stage2_new");
    expect(deletedExpressionTemplate.status).toBe("inactive");
  });

  it("locks admin strategy/expression enums to final canonical sets", () => {
    const allStrategyScenes = new Set(
      listRecommendationStrategies(LIST_QUERY).items.map((item) => item.scene),
    );
    expect(allStrategyScenes).toEqual(
      new Set([
        "hot_sale_restock",
        "stockout_restock",
        "campaign_stockup",
        "checkout_optimization",
      ]),
    );

    const purchaseStrategyScenes = new Set(
      listRecommendationStrategies(LIST_QUERY, { sceneGroup: "purchase" }).items.map(
        (item) => item.scene,
      ),
    );
    expect(purchaseStrategyScenes).toEqual(
      new Set(["hot_sale_restock", "stockout_restock", "campaign_stockup"]),
    );

    const templateTypes = new Set(
      listExpressionTemplates(LIST_QUERY).items.map((item) => item.template_type),
    );
    expect(templateTypes).toEqual(new Set(["bundle_explanation", "topup_explanation"]));
  });

  it("enforces campaigns structured linkage fields in validation and supports create/update in service", () => {
    const canonicalLikePayload = {
      campaign_id: "camp_stage2_structured",
      week_id: "2026-W16",
      campaign_name: "Stage2 结构化活动",
      weekly_focus_items: [],
      product_pool_ids: "pool_regular_replenishment,pool_pairing",
      promo_threshold: 900,
      promo_type: "threshold_rebate",
      activity_notes: ["stage2 structured note"],
      target_dealer_ids: "dealer_xm_sm,dealer_dg_sm",
      target_segment_ids: "seg_城区核心客户_餐饮流通",
      target_customer_types: [],
      status: "active",
    };

    const invalid = validateCampaignInput(canonicalLikePayload, "create");
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.fieldErrors.product_pool_ids).toContain("必须为字符串数组");
      expect(invalid.fieldErrors.target_dealer_ids).toContain("必须为字符串数组");
      expect(invalid.fieldErrors.target_segment_ids).toContain("必须为字符串数组");
    }

    const store = getMemoryStore();
    const targetDealers = store.dealers.slice(0, 2).map((item) => item.customer_id);
    const targetSegments = store.dealerSegments
      .slice(0, 2)
      .map((item) => item.segment_id);
    const createPayload = {
      ...canonicalLikePayload,
      product_pool_ids: ["pool_regular_replenishment", "pool_pairing"],
      target_dealer_ids: targetDealers,
      target_segment_ids: targetSegments,
    };

    const validated = validateCampaignInput(createPayload, "create");
    expect(validated.valid).toBe(true);
    if (!validated.valid) {
      throw new Error("expected campaign payload to pass canonical validation");
    }

    const created = createCampaign(validated.value);
    expect(created.product_pool_ids).toEqual(createPayload.product_pool_ids);
    expect(created.target_dealer_ids).toEqual(createPayload.target_dealer_ids);
    expect(created.target_segment_ids).toEqual(createPayload.target_segment_ids);

    const updatedDealers = [targetDealers[0]];
    const updatedSegments = [targetSegments[0]];
    const updated = updateCampaign(created.campaign_id, {
      product_pool_ids: ["pool_pairing"],
      target_dealer_ids: updatedDealers,
      target_segment_ids: updatedSegments,
    });
    expect(updated.product_pool_ids).toEqual(["pool_pairing"]);
    expect(updated.target_dealer_ids).toEqual(updatedDealers);
    expect(updated.target_segment_ids).toEqual(updatedSegments);
  });

  it("supports global-rules / generation-jobs / recommendation-batches / recommendation-records / recovery contracts", () => {
    const updatedGlobalRules = updateGlobalRules({
      global_rule_id: "global_rules_default",
      rule_version: "stage2.contract.001",
      replenishment_days_threshold: 7,
      cart_gap_trigger_amount: 28,
      threshold_amount: 1200,
      cart_target_amount: 1200,
      prefer_frequent_items: true,
      prefer_pair_items: true,
      box_adjust_if_close: false,
      box_adjust_distance_limit: 1,
      allow_new_product_recommendation: false,
      status: "active",
    });
    expect(updatedGlobalRules.rule_version).toBe("stage2.contract.001");
    expect(getGlobalRules().threshold_amount).toBe(1200);
    expect(getGlobalRules().cart_target_amount).toBe(1200);

    const createdJob = createGenerationJob({
      job_id: "job_stage2_new",
      job_name: "Stage2 任务",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: ["seg_城区核心客户_餐饮流通"],
      strategy_ids: ["tpl_purchase_hot_sale"],
      publish_mode: "manual",
      status: "ready",
      precheck_summary: "precheck ok",
    });
    expect(createdJob.job_id).toBe("job_stage2_new");
    expect(createdJob.publication_status).toBe("unpublished");
    expect(createdJob.published_batch_id).toBeUndefined();
    expect(createdJob.published_at).toBeUndefined();

    const seededPublishedJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(seededPublishedJob).toBeTruthy();
    expect(seededPublishedJob?.published_batch_id).toBeTruthy();
    expect(seededPublishedJob?.last_batch_id).toBe(seededPublishedJob?.published_batch_id);
    expect(seededPublishedJob && "published_batch_id" in seededPublishedJob).toBe(true);
    expect(seededPublishedJob && "published_at" in seededPublishedJob).toBe(true);
    if (seededPublishedJob?.published_batch_id) {
      expect(seededPublishedJob.publication_status).toBe("published");
      expect(seededPublishedJob.published_at).toBeTruthy();
    } else {
      expect(seededPublishedJob?.publication_status).toBe("ready");
      expect(seededPublishedJob?.published_at).toBeUndefined();
    }

    const cancelledJob = cancelGenerationJob("job_stage2_new");
    expect(cancelledJob.status).toBe("cancelled");
    expect(() => cancelGenerationJob("job_stage2_new")).toThrowError(AdminServiceError);

    const seededPurchaseRunId = getMemoryStore().recommendationRuns.find(
      (item) =>
        item.customer_id === "dealer_xm_sm" &&
        item.scene === "hot_sale_restock" &&
        item.surface === "purchase" &&
        item.generation_mode === "precomputed",
    )?.recommendation_run_id;
    expect(seededPurchaseRunId).toBeTruthy();

    const createdBatch = createRecommendationBatch({
      batch_id: "batch_stage2_new",
      batch_type: "sample_generation",
      trigger_source: "admin",
      customer_id: "dealer_xm_sm",
      scene: "hot_sale_restock",
      trace_id: "trace_stage2_new",
      related_run_ids: [seededPurchaseRunId ?? ""],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-16T01:00:00.000Z",
      finished_at: "2026-04-16T01:01:00.000Z",
      status: "success",
      fallback_used: false,
    });
    expect(createdBatch.batch_id).toBe("batch_stage2_new");

    const batchList = listRecommendationBatches(REPORT_QUERY, {
      customerId: "dealer_xm_sm",
      batchType: "sample_generation",
      status: "success",
    });
    expect(
      batchList.items.some((item) => item.batch_id === "batch_stage2_new"),
    ).toBe(true);

    const records = listRecommendationRecords(REPORT_QUERY, {
      customerId: "dealer_xm_sm",
    });
    expect(records.items.length).toBeGreaterThan(0);
    const detail = getRecommendationRecordDetail(seededPurchaseRunId ?? "");
    expect(detail?.run.recommendation_run_id).toBe(seededPurchaseRunId);

    const createdSnapshot = createRecoverySnapshot({
      snapshot_id: "snapshot_stage2_new",
      snapshot_name: "Stage2 snapshot",
      source: "manual",
      description: "stage2 recovery",
      config_snapshot_id: "cfg_stage2_new",
      related_entity_types: ["recommendation_strategies", "global_rules"],
      status: "available",
      created_by: "stage2-test",
    });
    expect(createdSnapshot.snapshot_id).toBe("snapshot_stage2_new");

    const appliedSnapshot = applyRecoverySnapshot("snapshot_stage2_new");
    expect(appliedSnapshot.status).toBe("applied");
    expect(getRecoverySnapshotById("snapshot_stage2_new")?.applied_at).toBeTruthy();

    const archivedSnapshot = archiveRecoverySnapshot("snapshot_stage2_new");
    expect(archivedSnapshot.status).toBe("archived");
    expect(() => archiveRecoverySnapshot("snapshot_stage2_new")).toThrowError(
      AdminServiceError,
    );
  });

  it("supports list surfaces for generation jobs and recommendation strategies", () => {
    const jobs = listGenerationJobs(REPORT_QUERY);
    expect(jobs.items.length).toBeGreaterThan(0);

    const strategies = listRecommendationStrategies(LIST_QUERY);
    expect(strategies.items.length).toBeGreaterThan(0);
  });

  it("locks seed purchase precomputed runs and purchase-vs-checkout batch boundaries", () => {
    const store = getMemoryStore();
    const canonicalPurchaseScenes = new Set([
      "hot_sale_restock",
      "stockout_restock",
      "campaign_stockup",
    ]);

    const purchaseRuns = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        canonicalPurchaseScenes.has(run.scene),
    );
    expect(purchaseRuns).toHaveLength(9);
    expect(new Set(purchaseRuns.map((run) => run.customer_id))).toEqual(
      new Set(["dealer_xm_sm", "dealer_dg_sm", "dealer_cd_pf"]),
    );
    expect(new Set(purchaseRuns.map((run) => run.scene))).toEqual(
      canonicalPurchaseScenes,
    );

    const seededJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(seededJob).toBeTruthy();
    expect(new Set(seededJob?.strategy_ids ?? [])).toEqual(
      new Set([
        "tpl_purchase_hot_sale",
        "tpl_purchase_stockout",
        "tpl_purchase_campaign",
      ]),
    );
    const seededBatchId = seededJob?.published_batch_id;
    expect(seededBatchId).toBeTruthy();

    const seededBatch = listRecommendationBatches(REPORT_QUERY, {
      jobId: "job_seed_2026-04-15",
    }).items.find((item) => item.batch_id === seededBatchId);
    expect(seededBatch).toBeTruthy();
    const purchaseBatchRunIds = new Set(seededBatch?.related_run_ids ?? []);
    expect(purchaseBatchRunIds.size).toBe(9);

    const batchRuns = store.recommendationRuns.filter((run) =>
      purchaseBatchRunIds.has(run.recommendation_run_id),
    );
    expect(batchRuns).toHaveLength(9);
    expect(
      batchRuns.every(
        (run) =>
          run.surface === "purchase" &&
          run.generation_mode === "precomputed" &&
          canonicalPurchaseScenes.has(run.scene),
      ),
    ).toBe(true);

    const checkoutRuns = store.recommendationRuns.filter(
      (run) => run.scene === "checkout_optimization",
    );
    expect(checkoutRuns).toHaveLength(1);
    expect(checkoutRuns[0].surface).toBe("checkout");
    expect(checkoutRuns[0].generation_mode).toBe("realtime");
    expect(checkoutRuns[0].batch_id).toBeUndefined();
    expect(purchaseBatchRunIds.has(checkoutRuns[0].recommendation_run_id)).toBe(false);

    const visiblePurchaseBatches = listRecommendationBatches(REPORT_QUERY).items;
    expect(visiblePurchaseBatches.some((item) => item.batch_id === seededBatchId)).toBe(true);
    expect(
      visiblePurchaseBatches.every(
        (batch) =>
          batch.related_run_ids
            .map((runId) =>
              store.recommendationRuns.find(
                (run) => run.recommendation_run_id === runId,
              ),
            )
            .filter((run): run is NonNullable<typeof run> => Boolean(run))
            .every(
              (run) =>
                run.surface === "purchase" && run.generation_mode === "precomputed",
            ),
      ),
    ).toBe(true);
  });

  it("keeps purchase generation/batch analytics stats isolated from checkout realtime records", () => {
    const store = getMemoryStore();
    const jobs = listGenerationJobs(REPORT_QUERY).items;
    const purchaseBatches = listRecommendationBatches(REPORT_QUERY).items;
    const purchaseRecords = listRecommendationRecords(REPORT_QUERY, {
      surface: "purchase",
      generationMode: "precomputed",
    }).items;
    const checkoutRealtimeRecords = listRecommendationRecords(REPORT_QUERY, {
      surface: "checkout",
      generationMode: "realtime",
    }).items;

    expect(jobs.length).toBeGreaterThan(0);
    expect(purchaseBatches.length).toBeGreaterThan(0);
    expect(purchaseRecords).toHaveLength(9);
    expect(checkoutRealtimeRecords).toHaveLength(1);

    const checkoutRunId = checkoutRealtimeRecords[0].recommendation_run_id;
    expect(
      purchaseBatches.every((batch) => !batch.related_run_ids.includes(checkoutRunId)),
    ).toBe(true);

    expect(
      purchaseBatches.every((batch) =>
        batch.related_run_ids
          .map((runId) =>
            store.recommendationRuns.find((run) => run.recommendation_run_id === runId),
          )
          .filter((run): run is NonNullable<typeof run> => Boolean(run))
          .every(
            (run) => run.surface === "purchase" && run.generation_mode === "precomputed",
          ),
      ),
    ).toBe(true);

    const publishedJob = jobs.find((job) => job.job_id === "job_seed_2026-04-15");
    expect(publishedJob?.published_batch_id).toBeTruthy();
    expect(
      purchaseBatches.some((batch) => batch.batch_id === publishedJob?.published_batch_id),
    ).toBe(true);
  });

  it("updateCampaign only marks campaign_stockup purchase snapshots stale", () => {
    const store = getMemoryStore();
    const purchaseRuns = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        ["hot_sale_restock", "stockout_restock", "campaign_stockup"].includes(run.scene),
    );
    expect(purchaseRuns.filter((run) => Boolean(run.stale_reason))).toHaveLength(0);

    updateCampaign("camp_2026w16_focus", {
      campaign_name: "Stage5 活动更新-仅活动备货过期",
    });

    const refreshedRuns = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        ["hot_sale_restock", "stockout_restock", "campaign_stockup"].includes(run.scene),
    );

    const campaignRuns = refreshedRuns.filter((run) => run.scene === "campaign_stockup");
    const nonCampaignRuns = refreshedRuns.filter((run) => run.scene !== "campaign_stockup");
    expect(campaignRuns).toHaveLength(3);
    expect(nonCampaignRuns).toHaveLength(6);
    expect(
      campaignRuns.every((run) =>
        (run.stale_reason ?? "").includes("活动配置变更：camp_2026w16_focus"),
      ),
    ).toBe(true);
    expect(nonCampaignRuns.every((run) => !run.stale_reason)).toBe(true);

    const checkoutRun = store.recommendationRuns.find(
      (run) => run.scene === "checkout_optimization",
    );
    expect(checkoutRun?.stale_reason).toBeUndefined();

    const seededJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(seededJob?.precheck_summary).toContain("快照状态：已过期（3 条待重生成）");
  });

  it("updateGlobalRules marks all purchase precomputed snapshots stale", () => {
    const store = getMemoryStore();
    const currentRules = getGlobalRules();
    updateGlobalRules({
      ...currentRules,
      rule_version: "stage5.global-rules.stale-all",
      threshold_amount: currentRules.threshold_amount + 50,
      cart_target_amount: currentRules.cart_target_amount + 50,
    });

    const purchaseRuns = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        ["hot_sale_restock", "stockout_restock", "campaign_stockup"].includes(run.scene),
    );
    expect(purchaseRuns).toHaveLength(9);
    expect(
      purchaseRuns.every((run) =>
        (run.stale_reason ?? "").includes("全局规则变更：stage5.global-rules.stale-all"),
      ),
    ).toBe(true);

    const checkoutRun = store.recommendationRuns.find(
      (run) => run.scene === "checkout_optimization",
    );
    expect(checkoutRun?.stale_reason).toBeUndefined();

    const seededJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(seededJob?.precheck_summary).toContain("快照状态：已过期（9 条待重生成）");
  });

  it("expression template scene boundary keeps topup clean but stales purchase on scene=all", () => {
    const store = getMemoryStore();

    updateExpressionTemplate("expr_cart_opt_default", {
      instruction: "Stage5 topup update should not stale purchase snapshots",
    });

    const staleAfterTopup = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        Boolean(run.stale_reason),
    );
    expect(staleAfterTopup).toHaveLength(0);

    const jobAfterTopup = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(jobAfterTopup?.precheck_summary).not.toContain("待重生成");

    updateExpressionTemplate("expr_cart_opt_default", {
      scene: "all",
      instruction: "Stage5 all-scene update should stale purchase snapshots",
    });

    const staleAfterAll = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        ["hot_sale_restock", "stockout_restock", "campaign_stockup"].includes(run.scene) &&
        Boolean(run.stale_reason),
    );
    expect(staleAfterAll).toHaveLength(9);
    expect(
      staleAfterAll.every((run) =>
        (run.stale_reason ?? "").includes("表达模板变更：expr_cart_opt_default"),
      ),
    ).toBe(true);

    const jobAfterAll = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    expect(jobAfterAll?.precheck_summary).toContain("快照状态：已过期（9 条待重生成）");
  });

  it("expression template scene=bundle marks purchase snapshots stale", () => {
    const store = getMemoryStore();
    updateExpressionTemplate("expr_recommendation_default", {
      instruction: "Stage5 bundle update should stale purchase snapshots",
    });

    const stalePurchaseRuns = store.recommendationRuns.filter(
      (run) =>
        run.surface === "purchase" &&
        run.generation_mode === "precomputed" &&
        ["hot_sale_restock", "stockout_restock", "campaign_stockup"].includes(run.scene) &&
        Boolean(run.stale_reason),
    );
    expect(stalePurchaseRuns).toHaveLength(9);
    expect(
      stalePurchaseRuns.every((run) =>
        (run.stale_reason ?? "").includes("表达模板变更：expr_recommendation_default"),
      ),
    ).toBe(true);
  });

  it("generateRecommendationsForCustomer returns three canonical purchase result sets with independent run ids", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-stage2-generate-purchase");
    try {
      const result = await generateRecommendationsForCustomer({
        session_id: "session_stage2_generate_purchase",
        customer_id: "dealer_xm_sm",
        trigger_source: "assistant",
        page_name: "/purchase",
      });

      const store = getMemoryStore();
      const expectations = [
        {
          scene: "hot_sale_restock",
          runId: result.summary.hot_sale_run_id,
          items: result.hotSaleRestockRecommendations,
        },
        {
          scene: "stockout_restock",
          runId: result.summary.stockout_run_id,
          items: result.stockoutRestockRecommendations,
        },
        {
          scene: "campaign_stockup",
          runId: result.summary.campaign_run_id,
          items: result.campaignStockupRecommendations,
        },
      ] as const;

      expect(
        new Set(expectations.map((item) => item.runId)).size,
      ).toBe(expectations.length);

      for (const expected of expectations) {
        expect(expected.items.length).toBeGreaterThan(0);
        const run = store.recommendationRuns.find(
          (item) => item.recommendation_run_id === expected.runId,
        );
        expect(run?.customer_id).toBe("dealer_xm_sm");
        expect(run?.scene).toBe(expected.scene);
        expect(run?.page_name).toBe("/purchase");

        const relatedRunIds = new Set(
          expected.items
            .map((item) => item.recommendation_item_id)
            .filter((item): item is string => Boolean(item))
            .map((recommendationItemId) =>
              store.recommendationItems.find(
                (record) => record.recommendation_item_id === recommendationItemId,
              ),
            )
            .filter((record): record is NonNullable<typeof record> => Boolean(record))
            .map((record) => record.recommendation_run_id),
        );
        expect(relatedRunIds).toEqual(new Set([expected.runId]));
      }
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("generateCartOptimizationForSession creates checkout realtime run without creating purchase batch", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-stage4-checkout-realtime");
    try {
      const store = getMemoryStore();
      const batchCountBefore = listRecommendationBatches(REPORT_QUERY).items.length;
      const runCountBefore = store.recommendationRuns.length;

      const result = await generateCartOptimizationForSession({
        session_id: "session_seed_002",
        customer_id: "dealer_cd_pf",
      });

      const newRunId = result.summary.recommendation_run_id;
      const newRun = store.recommendationRuns.find(
        (run) => run.recommendation_run_id === newRunId,
      );
      expect(newRun).toBeTruthy();
      expect(newRun?.scene).toBe("checkout_optimization");
      expect(newRun?.surface).toBe("checkout");
      expect(newRun?.generation_mode).toBe("realtime");
      expect(newRun?.page_name).toBe("/order-submit");
      expect(newRun?.batch_id).toBeUndefined();
      expect(newRun?.trace_id).toBeTruthy();

      expect(store.recommendationRuns.length).toBe(runCountBefore + 1);
      expect(listRecommendationBatches(REPORT_QUERY).items.length).toBe(batchCountBefore);
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("admin generation batch records 3 purchase run ids per dealer", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-stage2-admin-batch");
    try {
      const createdJob = createGenerationJob({
        job_id: "job_stage2_runtime_batch",
        job_name: "Stage2 运行时批次",
        business_date: "2026-04-16",
        target_dealer_ids: ["dealer_xm_sm", "dealer_dg_sm"],
        target_segment_ids: [],
        strategy_ids: [
          "tpl_purchase_hot_sale",
          "tpl_purchase_stockout",
          "tpl_purchase_campaign",
        ],
        publish_mode: "manual",
        status: "draft",
        precheck_summary: "pending",
      });

      const precheck = precheckGenerationJob(createdJob.job_id);
      expect(precheck.job.status).toBe("ready");

      const result = await replayGenerationJob(createdJob.job_id);
      expect(result.generated_run_ids).toHaveLength(6);
      expect(result.batch?.related_run_ids).toHaveLength(6);
      expect(new Set(result.sampled_customer_ids ?? [])).toEqual(
        new Set(["dealer_xm_sm", "dealer_dg_sm"]),
      );

      const store = getMemoryStore();
      const generatedRuns = (result.generated_run_ids ?? [])
        .map((runId) =>
          store.recommendationRuns.find(
            (run) => run.recommendation_run_id === runId,
          ),
        )
        .filter((run): run is NonNullable<typeof run> => Boolean(run));
      expect(generatedRuns).toHaveLength(6);

      const canonicalPurchaseScenes = new Set([
        "hot_sale_restock",
        "stockout_restock",
        "campaign_stockup",
      ]);
      expect(
        generatedRuns.every(
          (run) =>
            run.page_name === "/purchase" &&
            canonicalPurchaseScenes.has(run.scene),
        ),
      ).toBe(true);

      const scenesByDealer = new Map<string, Set<string>>();
      for (const run of generatedRuns) {
        const existing = scenesByDealer.get(run.customer_id) ?? new Set<string>();
        existing.add(run.scene);
        scenesByDealer.set(run.customer_id, existing);
      }

      expect(scenesByDealer.get("dealer_xm_sm")).toEqual(canonicalPurchaseScenes);
      expect(scenesByDealer.get("dealer_dg_sm")).toEqual(canonicalPurchaseScenes);
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("published purchase templates are mapped 1:1 from canonical scene-specific runs", () => {
    const store = getMemoryStore();
    const payload = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(payload.summary.published).toBe(true);
    expect(payload.summary.batch_id).toBeTruthy();

    const templateByType = new Map(
      payload.bundleTemplates.map((item) => [item.template_type, item]),
    );
    const templateScenePairs = [
      { templateType: "hot_sale_restock", scene: "hot_sale_restock" },
      { templateType: "stockout_restock", scene: "stockout_restock" },
      { templateType: "campaign_stockup", scene: "campaign_stockup" },
    ] as const;

    const runIdsByTemplate = new Set<string>();
    for (const pair of templateScenePairs) {
      const template = templateByType.get(pair.templateType);
      expect(template).toBeTruthy();
      expect(template?.source).toBe("published_recommendation");
      expect(template?.items.length).toBeGreaterThan(0);

      const recommendationItemId = template?.items[0].recommendation_item_id;
      expect(recommendationItemId).toBeTruthy();
      const record = store.recommendationItems.find(
        (item) => item.recommendation_item_id === recommendationItemId,
      );
      expect(record?.customer_id).toBe("dealer_xm_sm");
      expect(record?.scene).toBe(pair.scene);

      const run = store.recommendationRuns.find(
        (item) => item.recommendation_run_id === record?.recommendation_run_id,
      );
      expect(run?.scene).toBe(pair.scene);
      expect(run?.customer_id).toBe("dealer_xm_sm");
      runIdsByTemplate.add(run?.recommendation_run_id ?? "");
    }
    expect(runIdsByTemplate.size).toBe(3);

    const selectedBatch = store.recommendationBatches.find(
      (item) => item.batch_id === payload.summary.batch_id,
    );
    expect(selectedBatch).toBeTruthy();
    const dailyRunsInPublishedBatch = (selectedBatch?.related_run_ids ?? [])
      .map((runId) =>
        store.recommendationRuns.find(
          (run) => run.recommendation_run_id === runId,
        ),
      )
      .filter(
        (run) =>
          run?.customer_id === "dealer_xm_sm" && run.scene === "daily_recommendation",
      );
    expect(dailyRunsInPublishedBatch).toHaveLength(0);
  });

  it("matchCampaignsForDealer applies priority: dealer > segment > customer type", () => {
    const store = getMemoryStore();
    const dealer = store.dealers.find((item) => item.customer_id === "dealer_xm_sm");
    expect(dealer).toBeTruthy();

    const focusSkuIds = store.products
      .filter((item) => item.status === "active")
      .slice(0, 2)
      .map((item) => item.sku_id);
    const segmentId = "seg_stage3_priority";
    const dealerSegments = [
      {
        segment_id: segmentId,
        segment_name: "Stage3 优先级分群",
        description: "stage3 test segment",
        city_list: [],
        customer_types: [],
        channel_types: [],
        dealer_ids: [dealer?.customer_id ?? ""],
        status: "active" as const,
        created_at: "2026-04-16T00:00:00.000Z",
        updated_at: "2026-04-16T00:00:00.000Z",
      },
    ];
    const base = {
      week_id: "2026-W16",
      weekly_focus_items: focusSkuIds,
      promo_threshold: 900,
      promo_type: "threshold_rebate" as const,
      activity_notes: ["stage3 priority"],
      status: "active" as const,
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
    };
    const campaigns = [
      {
        ...base,
        campaign_id: "camp_stage3_priority_dealer",
        campaign_name: "Stage3 定向经销商活动",
        target_dealer_ids: [dealer?.customer_id ?? ""],
        target_segment_ids: [segmentId],
        target_customer_types: [dealer?.customer_type ?? ""],
      },
      {
        ...base,
        campaign_id: "camp_stage3_priority_segment",
        campaign_name: "Stage3 定向分群活动",
        target_dealer_ids: [],
        target_segment_ids: [segmentId],
        target_customer_types: [dealer?.customer_type ?? ""],
      },
      {
        ...base,
        campaign_id: "camp_stage3_priority_type",
        campaign_name: "Stage3 定向客群活动",
        target_dealer_ids: [],
        target_segment_ids: [],
        target_customer_types: [dealer?.customer_type ?? ""],
      },
    ];

    const withDealerTarget = matchCampaignsForDealer({
      campaigns,
      dealer: dealer!,
      dealerSegments,
      products: store.products,
    });
    expect(withDealerTarget).toHaveLength(1);
    expect(withDealerTarget[0].campaign.campaign_id).toBe("camp_stage3_priority_dealer");
    expect(withDealerTarget[0].match_scope).toBe("target_dealer");
    expect(withDealerTarget[0].match_priority).toBe(0);

    const withSegmentTarget = matchCampaignsForDealer({
      campaigns: campaigns.filter((item) => item.campaign_id !== "camp_stage3_priority_dealer"),
      dealer: dealer!,
      dealerSegments,
      products: store.products,
    });
    expect(withSegmentTarget).toHaveLength(1);
    expect(withSegmentTarget[0].campaign.campaign_id).toBe("camp_stage3_priority_segment");
    expect(withSegmentTarget[0].match_scope).toBe("target_segment");
    expect(withSegmentTarget[0].match_priority).toBe(1);

    const withCustomerTypeOnly = matchCampaignsForDealer({
      campaigns: campaigns.filter((item) => item.campaign_id === "camp_stage3_priority_type"),
      dealer: dealer!,
      dealerSegments,
      products: store.products,
    });
    expect(withCustomerTypeOnly).toHaveLength(1);
    expect(withCustomerTypeOnly[0].campaign.campaign_id).toBe("camp_stage3_priority_type");
    expect(withCustomerTypeOnly[0].match_scope).toBe("target_customer_type");
    expect(withCustomerTypeOnly[0].match_priority).toBe(2);
  });

  it("campaign_stockup generated run persists selected campaign_id", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-stage3-campaign-id");
    try {
      const result = await generateRecommendationsForCustomer({
        session_id: "session_stage3_campaign_id",
        customer_id: "dealer_xm_sm",
        trigger_source: "assistant",
        page_name: "/purchase",
      });
      const store = getMemoryStore();
      const campaignRun = store.recommendationRuns.find(
        (item) => item.recommendation_run_id === result.summary.campaign_run_id,
      );
      expect(campaignRun?.scene).toBe("campaign_stockup");
      expect(campaignRun?.campaign_id).toBeTruthy();

      const matched = matchCampaignsForDealer({
        campaigns: store.campaigns,
        dealer: store.dealers.find((item) => item.customer_id === "dealer_xm_sm")!,
        dealerSegments: store.dealerSegments,
        products: store.products,
      });
      expect(matched.length).toBeGreaterThan(0);
      expect(campaignRun?.campaign_id).toBe(matched[0].campaign.campaign_id);
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("published activity highlights are from matched campaigns and ordered by selected campaign run", () => {
    const store = getMemoryStore();
    const payload = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(payload.summary.published).toBe(true);
    expect(payload.summary.batch_id).toBeTruthy();

    const selectedBatch = store.recommendationBatches.find(
      (item) => item.batch_id === payload.summary.batch_id,
    );
    expect(selectedBatch).toBeTruthy();

    const selectedCampaignRun = (selectedBatch?.related_run_ids ?? [])
      .map((runId) =>
        store.recommendationRuns.find((run) => run.recommendation_run_id === runId),
      )
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .find(
        (run) => run.customer_id === "dealer_xm_sm" && run.scene === "campaign_stockup",
      );
    expect(selectedCampaignRun?.campaign_id).toBeTruthy();

    const matched = matchCampaignsForDealer({
      campaigns: store.campaigns,
      dealer: store.dealers.find((item) => item.customer_id === "dealer_xm_sm")!,
      dealerSegments: store.dealerSegments,
      products: store.products,
    });
    const matchedIds = matched.map((item) => item.campaign.campaign_id);
    expect(matchedIds.length).toBeGreaterThan(0);

    const activityIds = payload.activityHighlights.map((item) => item.activity_id);
    expect(activityIds.length).toBeGreaterThan(0);
    expect(
      activityIds.every((activityId) => matchedIds.includes(activityId)),
    ).toBe(true);

    const selectedCampaignId = selectedCampaignRun?.campaign_id ?? "";
    expect(activityIds[0]).toBe(selectedCampaignId);

    const expectedOrder = [...matchedIds];
    const selectedIndex = expectedOrder.indexOf(selectedCampaignId);
    if (selectedIndex > 0) {
      const [selected] = expectedOrder.splice(selectedIndex, 1);
      expectedOrder.unshift(selected);
    }
    expect(activityIds).toEqual(expectedOrder.slice(0, activityIds.length));
  });

  it("filters matched campaigns with no published weekly items instead of fabricating fallback activity cards", () => {
    const store = getMemoryStore();
    const dealer = store.dealers.find((item) => item.customer_id === "dealer_xm_sm");
    expect(dealer).toBeTruthy();

    const seededPayload = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    const seededActivitySkuIds = new Set(
      seededPayload.activityHighlights.flatMap((item) => item.sku_ids),
    );
    const inactiveSkuId = store.products.find(
      (item) => item.status === "active" && !seededActivitySkuIds.has(item.sku_id),
    )?.sku_id;
    expect(inactiveSkuId).toBeTruthy();

    store.campaigns.unshift({
      campaign_id: "camp_stage3_unpublished_activity_gap",
      campaign_name: "Stage3 已命中但未发布活动",
      week_id: "2026-W16",
      promo_type: "threshold_rebate",
      promo_threshold: 1200,
      target_dealer_ids: [dealer?.customer_id ?? ""],
      target_segment_ids: [],
      target_customer_types: [],
      weekly_focus_items: [inactiveSkuId ?? ""],
      activity_notes: ["matched but missing published weekly items"],
      status: "active",
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
    });

    const matched = matchCampaignsForDealer({
      campaigns: store.campaigns,
      dealer: dealer!,
      dealerSegments: store.dealerSegments,
      products: store.products,
    });
    expect(
      matched.some((item) => item.campaign.campaign_id === "camp_stage3_unpublished_activity_gap"),
    ).toBe(true);

    const payload = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(
      payload.activityHighlights.some(
        (item) => item.activity_id === "camp_stage3_unpublished_activity_gap",
      ),
    ).toBe(false);
  });

  it("campaign_stockup returns empty items when no campaign matches and does not fall back to global campaign pool", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-stage3-no-campaign");
    try {
      const store = getMemoryStore();
      store.dealers.push({
        customer_id: "dealer_stage3_no_campaign",
        customer_name: "Stage3 无活动匹配客户",
        city: "海口",
        customer_type: "测试未覆盖客户",
        channel_type: "测试未覆盖渠道",
        store_count_hint: "1",
        last_order_days_ago: 3,
        order_frequency: "7天",
        price_sensitivity: "中",
        new_product_acceptance: "中",
        frequent_items: [],
        forbidden_items: [],
        preferred_categories: ["酱油"],
        business_traits: [],
        status: "active",
        created_at: "2026-04-16T00:00:00.000Z",
        updated_at: "2026-04-16T00:00:00.000Z",
      });

      expect(
        store.campaigns.filter((campaign) => campaign.status === "active").length,
      ).toBeGreaterThan(0);

      const result = await generateRecommendationsForCustomer({
        session_id: "session_stage3_no_campaign",
        customer_id: "dealer_stage3_no_campaign",
        trigger_source: "assistant",
        page_name: "/purchase",
      });

      expect(result.campaignStockupRecommendations).toHaveLength(0);
      const campaignRun = store.recommendationRuns.find(
        (item) => item.recommendation_run_id === result.summary.campaign_run_id,
      );
      expect(campaignRun?.scene).toBe("campaign_stockup");
      expect(campaignRun?.campaign_id).toBeUndefined();
      expect(campaignRun?.candidate_sku_ids).toEqual([]);
      expect(campaignRun?.returned_sku_ids).toEqual([]);
      expect(campaignRun?.model_name).toBe("rule.match-only.no-campaign");
      expect(campaignRun?.prompt_snapshot).toContain(
        "当前客户未命中活动，请严格返回 {\"elements\": []}。",
      );
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("resets runtime data back to seed baseline", () => {
    updateGlobalRules({
      ...getGlobalRules(),
      rule_version: "runtime.override",
      threshold_amount: 1200,
      cart_target_amount: 1400,
    });

    const result = resetDemoData();

    expect(result.snapshot?.snapshot_id).toBe("snapshot_seed_default");
    expect(getGlobalRules().rule_version).toBe("2026.04.seed");
    expect(getGlobalRules().threshold_amount).toBe(1000);
    expect(getGlobalRules().cart_target_amount).toBe(1000);
  });

  it("validates recommendation batch run references", () => {
    expect(() =>
      createRecommendationBatch({
        batch_id: "batch_stage2_invalid",
        batch_type: "manual_replay",
        trigger_source: "admin",
        customer_id: "dealer_xm_sm",
        scene: "hot_sale_restock",
        related_run_ids: ["run_not_exists"],
        config_snapshot_id: "snapshot_seed_default",
        started_at: "2026-04-16T02:00:00.000Z",
        status: "running",
        fallback_used: false,
      }),
    ).toThrowError(AdminServiceError);
  });

  it("filters recommendation batches by jobId + publicationStatus in service layer", () => {
    const seededRunId = getMemoryStore().recommendationRuns.find(
      (item) =>
        item.customer_id === "dealer_xm_sm" &&
        item.scene === "hot_sale_restock" &&
        item.surface === "purchase" &&
        item.generation_mode === "precomputed",
    )?.recommendation_run_id;
    expect(seededRunId).toBeTruthy();

    const jobA = createGenerationJob({
      job_id: "job_stage2_batch_filter_a",
      job_name: "Stage2 批次过滤任务 A",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: [],
      strategy_ids: ["tpl_purchase_hot_sale"],
      publish_mode: "manual",
      status: "ready",
      precheck_summary: "precheck ok",
    });
    const jobB = createGenerationJob({
      job_id: "job_stage2_batch_filter_b",
      job_name: "Stage2 批次过滤任务 B",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: [],
      strategy_ids: ["tpl_purchase_hot_sale"],
      publish_mode: "manual",
      status: "ready",
      precheck_summary: "precheck ok",
    });

    createRecommendationBatch({
      batch_id: "batch_stage2_filter_ready",
      batch_type: "sample_generation",
      trigger_source: "admin",
      job_id: jobA.job_id,
      customer_id: "dealer_xm_sm",
      scene: "hot_sale_restock",
      trace_id: "trace_stage2_filter_ready",
      related_run_ids: [seededRunId ?? ""],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-16T05:00:00.000Z",
      finished_at: "2026-04-16T05:01:00.000Z",
      status: "success",
      publication_status: "ready",
      fallback_used: false,
    });
    createRecommendationBatch({
      batch_id: "batch_stage2_filter_published",
      batch_type: "sample_generation",
      trigger_source: "admin",
      job_id: jobA.job_id,
      customer_id: "dealer_xm_sm",
      scene: "hot_sale_restock",
      trace_id: "trace_stage2_filter_published",
      related_run_ids: [seededRunId ?? ""],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-16T05:05:00.000Z",
      finished_at: "2026-04-16T05:06:00.000Z",
      status: "success",
      publication_status: "published",
      fallback_used: false,
    });
    createRecommendationBatch({
      batch_id: "batch_stage2_filter_other_job",
      batch_type: "sample_generation",
      trigger_source: "admin",
      job_id: jobB.job_id,
      customer_id: "dealer_xm_sm",
      scene: "hot_sale_restock",
      trace_id: "trace_stage2_filter_other_job",
      related_run_ids: [seededRunId ?? ""],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-16T05:10:00.000Z",
      finished_at: "2026-04-16T05:11:00.000Z",
      status: "success",
      publication_status: "ready",
      fallback_used: false,
    });

    const filtered = listRecommendationBatches(REPORT_QUERY, {
      jobId: jobA.job_id,
      publicationStatus: "ready",
    });

    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].batch_id).toBe("batch_stage2_filter_ready");
  });

  it("supports recommendation run filtering by batch/strategy/expression linkage", () => {
    const store = getMemoryStore();
    const seededPublishedJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    const seededBatchId = seededPublishedJob?.published_batch_id;
    expect(seededBatchId).toBeTruthy();

    const seeded = store.recommendationRuns.find(
      (item) =>
        item.batch_id === seededBatchId &&
        item.strategy_id === "tpl_purchase_hot_sale" &&
        item.expression_template_id === "expr_recommendation_default",
    );
    expect(seeded).toBeTruthy();

    const filtered = listRecommendationRecords(REPORT_QUERY, {
      batchId: seededBatchId,
      strategyId: "tpl_purchase_hot_sale",
      expressionTemplateId: "expr_recommendation_default",
    });
    expect(
      filtered.items.some(
        (item) => item.recommendation_run_id === seeded?.recommendation_run_id,
      ),
    ).toBe(true);
  });

  it("returns canonical published suggestions payload for published and unpublished states", () => {
    const seededPublishedJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === "job_seed_2026-04-15",
    );
    const seededPublishedBatchId =
      seededPublishedJob?.published_batch_id ??
      seededPublishedJob?.last_batch_id ??
      seededPublishedJob?.last_sample_batch_id;
    expect(seededPublishedBatchId).toBeTruthy();

    const initial = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    if (!initial.summary.published) {
      const publishedResult = publishGenerationJob("job_seed_2026-04-15");
      expect(publishedResult.job.published_batch_id).toBe(seededPublishedBatchId);
      expect(publishedResult.job.published_at).toBeTruthy();
    }

    const published = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(published.summary.published).toBe(true);
    expect(published.summary.job_id).toBe("job_seed_2026-04-15");
    expect(published.summary.batch_id).toBe(seededPublishedBatchId);
    expect(published.bundleTemplates).toHaveLength(3);
    expect(published.bundleTemplates.map((item) => item.template_name)).toEqual([
      "热销补货",
      "缺货补货",
      "活动备货",
    ]);
    expect(published.activityHighlights.length).toBeGreaterThanOrEqual(0);
    expect(published.cartSummary).toMatchObject({
      sku_count: expect.any(Number),
      item_count: expect.any(Number),
      total_amount: expect.any(Number),
      threshold_amount: expect.any(Number),
      gap_to_threshold: expect.any(Number),
      threshold_reached: expect.any(Boolean),
    });
    expect("dailyRecommendations" in (published as Record<string, unknown>)).toBe(false);
    expect("weeklyFocusRecommendations" in (published as Record<string, unknown>)).toBe(
      false,
    );

    const store = getMemoryStore();
    for (const job of store.generationJobs) {
      job.publication_status = "unpublished";
      job.published_batch_id = undefined;
      job.published_at = undefined;
    }
    for (const batch of store.recommendationBatches) {
      batch.publication_status = "unpublished";
    }

    const unpublished = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(unpublished.summary.published).toBe(false);
    expect(unpublished.bundleTemplates).toHaveLength(3);
    expect(unpublished.cartSummary).toMatchObject({
      sku_count: expect.any(Number),
      item_count: expect.any(Number),
      total_amount: expect.any(Number),
      threshold_amount: expect.any(Number),
      gap_to_threshold: expect.any(Number),
      threshold_reached: expect.any(Boolean),
    });
    expect("dailyRecommendations" in (unpublished as Record<string, unknown>)).toBe(false);
    expect("weeklyFocusRecommendations" in (unpublished as Record<string, unknown>)).toBe(
      false,
    );
  });

  it("publishes target batch and writes published batch metadata back to generation job", () => {
    const seededRunId = getMemoryStore().recommendationRuns.find(
      (item) =>
        item.customer_id === "dealer_xm_sm" &&
        item.scene === "hot_sale_restock" &&
        item.surface === "purchase" &&
        item.generation_mode === "precomputed",
    )?.recommendation_run_id;
    expect(seededRunId).toBeTruthy();

    const createdJob = createGenerationJob({
      job_id: "job_stage2_publish",
      job_name: "Stage2 发布测试任务",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: [],
      strategy_ids: ["tpl_purchase_hot_sale"],
      publish_mode: "manual",
      status: "ready",
      precheck_summary: "precheck ok",
      publication_status: "ready",
    });

    const createdBatch = createRecommendationBatch({
      batch_id: "batch_stage2_publish",
      batch_type: "sample_generation",
      trigger_source: "admin",
      job_id: createdJob.job_id,
      customer_id: "dealer_xm_sm",
      scene: "hot_sale_restock",
      trace_id: "trace_stage2_publish",
      related_run_ids: [seededRunId ?? ""],
      config_snapshot_id: "snapshot_seed_default",
      started_at: "2026-04-16T04:00:00.000Z",
      finished_at: "2026-04-16T04:01:00.000Z",
      status: "success",
      fallback_used: false,
    });
    updateGenerationJob(createdJob.job_id, {
      last_sample_batch_id: createdBatch.batch_id,
      last_batch_id: createdBatch.batch_id,
      publication_status: "ready",
    });

    const result = publishGenerationJob(createdJob.job_id);
    expect(result.batch?.batch_id).toBe(createdBatch.batch_id);
    expect(result.batch?.publication_status).toBe("published");
    expect(result.job.publication_status).toBe("published");
    expect(result.job.published_batch_id).toBe(createdBatch.batch_id);
    expect(result.job.published_at).toBeTruthy();

    const persistedJob = listGenerationJobs(REPORT_QUERY).items.find(
      (item) => item.job_id === createdJob.job_id,
    );
    expect(persistedJob?.publication_status).toBe("published");
    expect(persistedJob?.published_batch_id).toBe(createdBatch.batch_id);
    expect(persistedJob?.published_at).toBe(result.job.published_at);

    const persistedBatch = listRecommendationBatches(REPORT_QUERY, {
      batchType: "sample_generation",
      customerId: "dealer_xm_sm",
    }).items.find((item) => item.batch_id === createdBatch.batch_id);
    expect(persistedBatch?.publication_status).toBe("published");
  });

  it("replays a single purchase recommendation record", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-admin-replay-daily");
    try {
      const seedPurchaseRunId = getMemoryStore().recommendationRuns.find(
        (item) =>
          item.customer_id === "dealer_xm_sm" &&
          item.scene === "hot_sale_restock" &&
          item.surface === "purchase" &&
          item.generation_mode === "precomputed",
      )?.recommendation_run_id;
      expect(seedPurchaseRunId).toBeTruthy();

      const result = await replayRecommendationRecord(seedPurchaseRunId ?? "");
      expect(result.generated_run_ids).toHaveLength(1);
      expect(result.summary).toContain("补货建议");

      const replayRun = getMemoryStore().recommendationRuns.find(
        (item) => item.recommendation_run_id === result.generated_run_ids[0],
      );
      expect(replayRun?.customer_id).toBe("dealer_xm_sm");
      expect(replayRun?.page_name).toBe("/purchase");
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("replays a single cart optimization record with seeded cart context", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-admin-replay-cart");
    try {
      const batchCountBefore = listRecommendationBatches(REPORT_QUERY).items.length;
      const result = await replayRecommendationRecord("reco_run_seed_002");
      expect(result.generated_run_ids).toHaveLength(1);
      expect(result.summary).toContain("结算页实时凑单建议");
      expect(result.batch).toBeUndefined();
      expect(result.trace_id).toBeTruthy();

      const store = getMemoryStore();
      const replayRun = store.recommendationRuns.find(
        (item) => item.recommendation_run_id === result.generated_run_ids[0],
      );
      expect(replayRun?.customer_id).toBe("dealer_cd_pf");
      expect(replayRun?.scene).toBe("checkout_optimization");
      expect(replayRun?.surface).toBe("checkout");
      expect(replayRun?.generation_mode).toBe("realtime");
      expect(replayRun?.batch_id).toBeUndefined();
      expect(store.cartSessions[replayRun?.session_id ?? ""]?.items.length).toBeGreaterThan(
        0,
      );
      expect(listRecommendationBatches(REPORT_QUERY).items.length).toBe(batchCountBefore);
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("supports purchase vs checkout record scopes with surface/generationMode filters", () => {
    const hotSaleRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "hot_sale_restock",
    });
    const stockoutRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "stockout_restock",
    });
    const campaignRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "campaign_stockup",
    });
    const purchaseViewRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "purchase_bundle",
      surface: "purchase",
      generationMode: "precomputed",
    });
    const checkoutViewRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "checkout_optimization",
      surface: "checkout",
      generationMode: "realtime",
    });

    expect(hotSaleRecords.items.length).toBeGreaterThan(0);
    expect(stockoutRecords.items.length).toBeGreaterThan(0);
    expect(campaignRecords.items.length).toBeGreaterThan(0);
    expect(purchaseViewRecords.items.length).toBeGreaterThan(0);
    expect(checkoutViewRecords.items.length).toBeGreaterThan(0);

    expect(hotSaleRecords.items.every((item) => item.scene === "hot_sale_restock")).toBe(
      true,
    );
    expect(stockoutRecords.items.every((item) => item.scene === "stockout_restock")).toBe(
      true,
    );
    expect(campaignRecords.items.every((item) => item.scene === "campaign_stockup")).toBe(
      true,
    );
    expect(
      purchaseViewRecords.items.every(
        (item) =>
          item.surface === "purchase" && item.generation_mode === "precomputed",
      ),
    ).toBe(true);
    expect(
      checkoutViewRecords.items.every(
        (item) => item.surface === "checkout" && item.generation_mode === "realtime",
      ),
    ).toBe(true);
    expect(
      checkoutViewRecords.items.every((item) => item.page_name === "/order-submit"),
    ).toBe(true);
  });
});
