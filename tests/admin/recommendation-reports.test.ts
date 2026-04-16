import { beforeEach, describe, expect, it } from "vitest";

import { type ListQuery } from "../../lib/admin/list-query";
import {
  getRecommendationRunDetail,
  listRecommendationRuns,
} from "../../lib/admin/service";
import {
  createRecommendationItems,
  createRecommendationRun,
  markRecommendationItemDecision,
} from "../../lib/domain/recommendation-lifecycle";
import { resetRuntimeState } from "../helpers/runtime";

const REPORT_QUERY: ListQuery = {
  page: 1,
  pageSize: 200,
  q: "",
  status: "",
  sortBy: "created_at",
  sortOrder: "desc",
};

describe("recommendation report query semantics", () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it("maps adoptionStatus=adopted to partially/fully applied runs", () => {
    const result = listRecommendationRuns(REPORT_QUERY, {
      adoptionStatus: "adopted",
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => ["partially_applied", "fully_applied"].includes(item.status))).toBe(true);
  });

  it("filters by customerId, scene, skuId and modelName together", () => {
    const run = createRecommendationRun({
      session_id: "sess_stage5_report",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "threshold_topup",
      page_name: "/basket",
      trigger_source: "assistant",
      prompt_snapshot: "stage5 report prompt",
      candidate_sku_ids: ["cb_chicken_essence_200"],
      returned_sku_ids: ["cb_chicken_essence_200"],
      model_name: "mock-stage5-report",
      model_latency_ms: 88,
    });
    createRecommendationItems(run, [
      {
        sku_id: "cb_chicken_essence_200",
        sku_name: "厨邦鸡精",
        suggested_qty: 1,
        suggested_rank: 1,
        reason: "补齐门槛",
        reason_tags: ["threshold"],
        action_type: "add_to_cart",
        effect_type: "threshold_reached",
      },
    ]);

    const filtered = listRecommendationRuns(REPORT_QUERY, {
      customerId: "dealer_xm_sm",
      scene: "threshold_topup",
      skuId: "cb_chicken_essence_200",
      modelName: "stage5-report",
    });

    expect(filtered.items.some((item) => item.recommendation_run_id === run.recommendation_run_id)).toBe(true);
  });

  it("maps adoptionStatus=not_adopted to generated/ignored runs", () => {
    const generatedRun = createRecommendationRun({
      session_id: "sess_stage5_generated",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "daily_recommendation",
      page_name: "/procurement",
      trigger_source: "manual",
      prompt_snapshot: "generated run",
      candidate_sku_ids: ["cb_weijixian_500"],
      returned_sku_ids: ["cb_weijixian_500"],
      model_name: "mock-stage5-generated",
      model_latency_ms: 66,
    });
    const ignoredRun = createRecommendationRun({
      session_id: "sess_stage5_ignored",
      customer_id: "dealer_xm_sm",
      customer_name: "厦门思明经销商",
      scene: "weekly_focus",
      page_name: "/catalog",
      trigger_source: "manual",
      prompt_snapshot: "ignored run",
      candidate_sku_ids: ["cb_oyster_700"],
      returned_sku_ids: ["cb_oyster_700"],
      model_name: "mock-stage5-ignored",
      model_latency_ms: 77,
    });
    const [ignoredItem] = createRecommendationItems(ignoredRun, [
      {
        sku_id: "cb_oyster_700",
        sku_name: "厨邦蚝油",
        suggested_qty: 1,
        suggested_rank: 1,
        reason: "ignored",
        reason_tags: ["stage5"],
        action_type: "add_to_cart",
        effect_type: "weekly_focus",
      },
    ]);
    markRecommendationItemDecision({
      recommendation_item_id: ignoredItem.recommendation_item_id,
      decision: "ignored",
    });

    const notAdopted = listRecommendationRuns(REPORT_QUERY, {
      adoptionStatus: "not_adopted",
    });
    const ids = new Set(notAdopted.items.map((item) => item.recommendation_run_id));
    expect(ids.has(generatedRun.recommendation_run_id)).toBe(true);
    expect(ids.has(ignoredRun.recommendation_run_id)).toBe(true);
    expect(notAdopted.items.every((item) => ["generated", "ignored"].includes(item.status))).toBe(
      true,
    );
  });

  it("returns run detail with item list for drill-down", () => {
    const run = createRecommendationRun({
      session_id: "sess_stage5_detail",
      customer_id: "dealer_dg_sm",
      customer_name: "东莞商超配送经销商",
      scene: "weekly_focus",
      page_name: "/basket",
      trigger_source: "manual",
      prompt_snapshot: "stage5 detail prompt",
      candidate_sku_ids: ["cb_small_shengchou_250"],
      returned_sku_ids: ["cb_small_shengchou_250"],
      model_name: "mock-stage5-detail",
      model_latency_ms: 92,
    });
    createRecommendationItems(run, [
      {
        sku_id: "cb_small_shengchou_250",
        sku_name: "厨邦小包装生抽",
        suggested_qty: 2,
        suggested_rank: 1,
        reason: "detail",
        reason_tags: ["stage5"],
        action_type: "add_to_cart",
        effect_type: "weekly_focus",
      },
    ]);

    const detail = getRecommendationRunDetail(run.recommendation_run_id);
    expect(detail?.run.recommendation_run_id).toBe(run.recommendation_run_id);
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0].sku_id).toBe("cb_small_shengchou_250");
  });
});
