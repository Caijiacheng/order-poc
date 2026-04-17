import { beforeEach, describe, expect, it } from "vitest";

import {
  createRecommendationItems,
  createRecommendationRun,
  expireOpenItemsForScene,
  markRecommendationItemApplied,
  markRecommendationItemDecision,
  markSubmittedItemsForSession,
  refreshRunStatus,
} from "../../lib/domain/recommendation-lifecycle";
import { getMemoryStore } from "../../lib/memory/store";
import type { SuggestionScene } from "../../lib/memory/types";
import { resetRuntimeState } from "../helpers/runtime";

type RecommendationPageName = "/purchase" | "/order-submit";

function createRunAndItems(
  scene: SuggestionScene = "daily_recommendation",
  pageName: RecommendationPageName = "/purchase",
) {
  const run = createRecommendationRun({
    session_id: "sess_stage5",
    customer_id: "dealer_xm_sm",
    customer_name: "厦门思明经销商",
    scene,
    page_name: pageName,
    trigger_source: "manual",
    prompt_snapshot: "stage5 prompt",
    candidate_sku_ids: ["cb_weijixian_500", "cb_oyster_700"],
    returned_sku_ids: ["cb_weijixian_500", "cb_oyster_700"],
    model_name: "mock-stage5",
    model_latency_ms: 100,
  });
  const items = createRecommendationItems(run, [
    {
      sku_id: "cb_weijixian_500",
      sku_name: "厨邦味极鲜特级生抽",
      suggested_qty: 2,
      suggested_rank: 1,
      reason: "测试条目1",
      reason_tags: ["rule"],
      action_type: "add_to_cart",
      effect_type: "replenishment",
    },
    {
      sku_id: "cb_oyster_700",
      sku_name: "厨邦蚝油",
      suggested_qty: 1,
      suggested_rank: 2,
      reason: "测试条目2",
      reason_tags: ["rule"],
      action_type: "add_to_cart",
      effect_type: "pair_item",
    },
  ]);
  return { run, items };
}

describe("recommendation-lifecycle transitions", () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it("updates run status from generated -> partially_applied -> fully_applied", () => {
    const { run, items } = createRunAndItems();

    const firstApply = markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 2,
      applied_by: "user",
    });
    expect(firstApply.changed).toBe(true);

    const partiallyAppliedRun = refreshRunStatus(run.recommendation_run_id);
    expect(partiallyAppliedRun?.status).toBe("partially_applied");

    const ignored = markRecommendationItemDecision({
      recommendation_item_id: items[1].recommendation_item_id,
      decision: "ignored",
    });
    expect(ignored?.final_status).toBe("ignored");

    const fullyAppliedRun = refreshRunStatus(run.recommendation_run_id);
    expect(fullyAppliedRun?.status).toBe("fully_applied");
  });

  it("marks run ignored when all open items are closed without any applied item", () => {
    const { run, items } = createRunAndItems();

    markRecommendationItemDecision({
      recommendation_item_id: items[0].recommendation_item_id,
      decision: "ignored",
    });
    markRecommendationItemDecision({
      recommendation_item_id: items[1].recommendation_item_id,
      decision: "rejected",
      rejected_reason: "manual_reject",
    });

    const updatedRun = refreshRunStatus(run.recommendation_run_id);
    expect(updatedRun?.status).toBe("ignored");
  });

  it("treats repeated apply with same qty as idempotent no-op", () => {
    const { run, items } = createRunAndItems();

    const first = markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 3,
      applied_by: "user",
    });
    expect(first.changed).toBe(true);
    expect(first.reason).toBe("applied");

    const second = markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 3,
      applied_by: "user",
    });
    expect(second.changed).toBe(false);
    expect(second.reason).toBe("already_applied");

    const updatedRun = refreshRunStatus(run.recommendation_run_id);
    expect(updatedRun?.status).toBe("partially_applied");
  });

  it("blocks apply for ignored/rejected recommendation items", () => {
    const { items } = createRunAndItems();

    markRecommendationItemDecision({
      recommendation_item_id: items[0].recommendation_item_id,
      decision: "ignored",
    });

    const appliedIgnoredItem = markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 2,
      applied_by: "user",
    });
    expect(appliedIgnoredItem.changed).toBe(false);
    expect(appliedIgnoredItem.reason).toBe("terminal_ignored_or_rejected");
  });

  it("expires open items for the same dealer+scene and keeps applied items intact", () => {
    const { run, items } = createRunAndItems("weekly_focus");
    markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 2,
      applied_by: "user",
    });

    expireOpenItemsForScene({
      customer_id: "dealer_xm_sm",
      scene: "weekly_focus",
    });

    const store = getMemoryStore();
    const firstItem = store.recommendationItems.find(
      (item) => item.recommendation_item_id === items[0].recommendation_item_id,
    );
    const secondItem = store.recommendationItems.find(
      (item) => item.recommendation_item_id === items[1].recommendation_item_id,
    );

    expect(firstItem?.final_status).toBe("applied");
    expect(secondItem?.final_status).toBe("expired");
    expect(refreshRunStatus(run.recommendation_run_id)?.status).toBe("fully_applied");
  });

  it("marks applied items as submitted_with_order for the matching session", () => {
    const { run, items } = createRunAndItems();
    markRecommendationItemApplied({
      recommendation_item_id: items[0].recommendation_item_id,
      applied_qty: 2,
      applied_by: "user",
    });

    markSubmittedItemsForSession({
      session_id: "sess_stage5",
      submitted_sku_ids: ["cb_weijixian_500"],
    });

    const store = getMemoryStore();
    const submittedItem = store.recommendationItems.find(
      (item) => item.recommendation_item_id === items[0].recommendation_item_id,
    );
    expect(submittedItem?.final_status).toBe("submitted_with_order");
    expect(submittedItem?.order_submitted_with_item).toBe(true);
    expect(refreshRunStatus(run.recommendation_run_id)?.status).toBe("partially_applied");
  });
});
