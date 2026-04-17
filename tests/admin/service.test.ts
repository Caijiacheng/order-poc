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
  createSuggestionTemplate,
  getExpressionTemplateById,
  getGlobalRules,
  getPublishedSuggestionsForCustomer,
  getRecommendationRecordDetail,
  getRecoverySnapshotById,
  getRules,
  getSuggestionTemplateById,
  listGenerationJobs,
  listRecommendationBatches,
  listRecommendationRecords,
  listRecommendationStrategies,
  listSuggestionTemplates,
  publishGenerationJob,
  softDeleteExpressionTemplate,
  softDeleteSuggestionTemplate,
  updateCampaign,
  updateGenerationJob,
  updateExpressionTemplate,
  updateGlobalRules,
  updatePrompts,
  updateRules,
  updateSuggestionTemplate,
} from "../../lib/admin/service";
import type { ListQuery } from "../../lib/admin/list-query";
import { validateCampaignInput } from "../../lib/admin/validation";
import { getMemoryStore } from "../../lib/memory/store";
import { resetRuntimeState } from "../helpers/runtime";

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
      template_type: "recommendation",
      scene: "all",
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
      scene: "daily_recommendation",
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
      prefer_frequent_items: true,
      prefer_pair_items: true,
      box_adjust_if_close: false,
      box_adjust_distance_limit: 1,
      allow_new_product_recommendation: false,
      status: "active",
    });
    expect(updatedGlobalRules.rule_version).toBe("stage2.contract.001");
    expect(getGlobalRules().threshold_amount).toBe(1200);

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

  it("keeps legacy suggestion-template adapter working on top of recommendation-strategies source-of-truth", () => {
    const createdLegacy = createSuggestionTemplate({
      template_id: "tpl_stage2_legacy",
      customer_id: "dealer_xm_sm",
      template_name: "Stage2 兼容模板",
      scene: "weekly_focus",
      reference_items: [
        {
          sku_id: "cb_zeroadd_shengchou_500",
          qty: 2,
          reason: "stage2 legacy reason",
          reason_tags: ["legacy"],
          sort_order: 1,
        },
      ],
      business_notes: "legacy note",
      style_hint: "legacy style",
      priority: 9,
      enabled: true,
    });
    expect(createdLegacy.template_id).toBe("tpl_stage2_legacy");

    const strategy = listRecommendationStrategies(LIST_QUERY).items.find(
      (item) => item.strategy_id === "tpl_stage2_legacy",
    );
    expect(strategy?.strategy_name).toBe("Stage2 兼容模板");
    expect(strategy?.status).toBe("active");

    updateSuggestionTemplate("tpl_stage2_legacy", {
      template_name: "Stage2 兼容模板(更新)",
      reference_items: [
        {
          sku_id: "cb_zeroadd_head_500",
          qty: 3,
          reason: "stage2 legacy reason updated",
          reason_tags: ["legacy-updated"],
          sort_order: 1,
        },
      ],
    });
    expect(getSuggestionTemplateById("tpl_stage2_legacy")?.template_name).toBe(
      "Stage2 兼容模板(更新)",
    );
    expect(getSuggestionTemplateById("tpl_stage2_legacy")?.enabled).toBe(true);

    const deletedLegacy = softDeleteSuggestionTemplate("tpl_stage2_legacy");
    expect(deletedLegacy.enabled).toBe(false);
    expect(() => softDeleteSuggestionTemplate("tpl_stage2_legacy")).toThrowError(
      AdminServiceError,
    );
  });

  it("keeps legacy prompts/rules adapters writable while syncing new expression/global objects", () => {
    const nextPrompts = {
      global_style: {
        tone: "偏执行语气",
        avoid: ["模糊建议"],
        reason_limit: 2,
      },
      recommendation_prompt: {
        system_role: "stage2 recommendation role",
        instruction: "stage2 recommendation instruction",
      },
      cart_opt_prompt: {
        system_role: "stage2 cart role",
        instruction: "stage2 cart instruction",
      },
      explain_prompt: {
        system_role: "stage2 explain role",
        instruction: "stage2 explain instruction",
      },
    };
    const updatedPrompts = updatePrompts(nextPrompts);
    expect(updatedPrompts.recommendation_prompt.system_role).toBe(
      "stage2 recommendation role",
    );

    const recommendationExpression = getExpressionTemplateById(
      "expr_recommendation_default",
    );
    expect(recommendationExpression?.system_role).toBe("stage2 recommendation role");
    expect(recommendationExpression?.reason_limit).toBe(2);

    const nextRules = {
      replenishment_days_threshold: 8,
      cart_gap_trigger_amount: 25,
      threshold_amount: 1300,
      prefer_frequent_items: true,
      prefer_pair_items: false,
      box_adjust_if_close: true,
      box_adjust_distance_limit: 3,
      allow_new_product_recommendation: true,
    };
    const updatedRules = updateRules(nextRules);
    expect(updatedRules.threshold_amount).toBe(1300);
    expect(getRules().threshold_amount).toBe(1300);
    expect(getGlobalRules().threshold_amount).toBe(1300);
  });

  it("supports list surfaces for generation jobs and legacy templates", () => {
    const jobs = listGenerationJobs(REPORT_QUERY);
    expect(jobs.items.length).toBeGreaterThan(0);

    const templates = listSuggestionTemplates(LIST_QUERY);
    expect(templates.items.length).toBeGreaterThan(0);
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

  it("returns published daily/weekly suggestions from seed and empty payload when unpublished", () => {
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
    expect(published.dailyRecommendations).toHaveLength(1);
    expect(published.dailyRecommendations[0]).toMatchObject({
      recommendation_item_id: "reco_item_seed_002",
      sku_id: "cb_oyster_700",
      suggested_qty: 8,
      priority: 2,
      action_type: "add_to_cart",
    });
    expect(published.weeklyFocusRecommendations).toEqual([]);

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
    expect(unpublished).toEqual({
      dailyRecommendations: [],
      weeklyFocusRecommendations: [],
      summary: { published: false },
    });
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
});
