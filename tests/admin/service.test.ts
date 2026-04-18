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
  publishGenerationJob,
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
      scene: "replenishment_bundle",
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
    const strategyScenes = new Set(
      listRecommendationStrategies(LIST_QUERY).items.map((item) => item.scene),
    );
    expect(strategyScenes).toEqual(
      new Set(["hot_sale_bundle", "replenishment_bundle", "campaign_bundle"]),
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
      strategy_ids: ["tpl_xm_daily"],
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
    expect(seededPublishedJob?.last_batch_id).toBe("batch_seed_001");
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

    const createdBatch = createRecommendationBatch({
      batch_id: "batch_stage2_new",
      batch_type: "sample_generation",
      trigger_source: "admin",
      customer_id: "dealer_xm_sm",
      scene: "daily_recommendation",
      trace_id: "trace_stage2_new",
      related_run_ids: ["reco_run_seed_001"],
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
    const detail = getRecommendationRecordDetail("reco_run_seed_001");
    expect(detail?.run.recommendation_run_id).toBe("reco_run_seed_001");

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
        scene: "daily_recommendation",
        related_run_ids: ["run_not_exists"],
        config_snapshot_id: "snapshot_seed_default",
        started_at: "2026-04-16T02:00:00.000Z",
        status: "running",
        fallback_used: false,
      }),
    ).toThrowError(AdminServiceError);
  });

  it("filters recommendation batches by jobId + publicationStatus in service layer", () => {
    const jobA = createGenerationJob({
      job_id: "job_stage2_batch_filter_a",
      job_name: "Stage2 批次过滤任务 A",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: [],
      strategy_ids: ["tpl_xm_daily"],
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
      strategy_ids: ["tpl_xm_daily"],
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
      scene: "daily_recommendation",
      trace_id: "trace_stage2_filter_ready",
      related_run_ids: ["reco_run_seed_001"],
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
      scene: "daily_recommendation",
      trace_id: "trace_stage2_filter_published",
      related_run_ids: ["reco_run_seed_001"],
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
      scene: "daily_recommendation",
      trace_id: "trace_stage2_filter_other_job",
      related_run_ids: ["reco_run_seed_001"],
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
    const seeded = store.recommendationRuns.find(
      (item) => item.recommendation_run_id === "reco_run_seed_001",
    );
    expect(seeded).toBeTruthy();

    const filtered = listRecommendationRecords(REPORT_QUERY, {
      batchId: "batch_seed_001",
      strategyId: "tpl_xm_daily",
      expressionTemplateId: "expr_recommendation_default",
    });
    expect(
      filtered.items.some((item) => item.recommendation_run_id === "reco_run_seed_001"),
    ).toBe(true);
  });

  it("returns canonical published suggestions payload for published and unpublished states", () => {
    const initial = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    if (!initial.summary.published) {
      const publishedResult = publishGenerationJob("job_seed_2026-04-15");
      expect(publishedResult.job.published_batch_id).toBe("batch_seed_001");
      expect(publishedResult.job.published_at).toBeTruthy();
    }

    const published = getPublishedSuggestionsForCustomer("dealer_xm_sm");
    expect(published.summary.published).toBe(true);
    expect(published.summary.job_id).toBe("job_seed_2026-04-15");
    expect(published.summary.batch_id).toBe("batch_seed_001");
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
    const createdJob = createGenerationJob({
      job_id: "job_stage2_publish",
      job_name: "Stage2 发布测试任务",
      business_date: "2026-04-16",
      target_dealer_ids: ["dealer_xm_sm"],
      target_segment_ids: [],
      strategy_ids: ["tpl_xm_daily"],
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
      scene: "daily_recommendation",
      trace_id: "trace_stage2_publish",
      related_run_ids: ["reco_run_seed_001"],
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

  it("replays a single daily recommendation record as the same scene only", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-admin-replay-daily");
    try {
      const result = await replayRecommendationRecord("reco_run_seed_001");
      expect(result.generated_run_ids).toHaveLength(1);
      expect(result.summary).toContain("日常补货建议");
      expect(result.batch.scene).toBe("daily_recommendation");

      const replayRun = getMemoryStore().recommendationRuns.find(
        (item) => item.recommendation_run_id === result.generated_run_ids[0],
      );
      expect(replayRun?.scene).toBe("daily_recommendation");
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("replays a single cart optimization record with seeded cart context", async () => {
    const envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-admin-replay-cart");
    try {
      const result = await replayRecommendationRecord("reco_run_seed_002");
      expect(result.generated_run_ids).toHaveLength(1);
      expect(result.summary).toContain("凑单推荐");
      expect(result.batch.scene).toBe("box_pair_optimization");

      const store = getMemoryStore();
      const replayRun = store.recommendationRuns.find(
        (item) => item.recommendation_run_id === result.generated_run_ids[0],
      );
      expect(replayRun?.scene).toBe("box_pair_optimization");
      expect(store.cartSessions[result.batch.session_id ?? ""]?.items.length).toBeGreaterThan(0);
    } finally {
      restoreLlmEnv(envSnapshot);
    }
  });

  it("supports purchase vs checkout record scopes", () => {
    const purchaseRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "purchase_bundle",
    });
    expect(
      purchaseRecords.items.every(
        (item) =>
          item.scene === "daily_recommendation" || item.scene === "weekly_focus",
      ),
    ).toBe(true);

    const checkoutRecords = listRecommendationRecords(REPORT_QUERY, {
      scene: "checkout_optimization",
    });
    expect(
      checkoutRecords.items.every(
        (item) =>
          item.scene === "box_pair_optimization" || item.scene === "threshold_topup",
      ),
    ).toBe(true);
  });
});
