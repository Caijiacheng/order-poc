import { randomUUID } from "node:crypto";

import { appendMetricEvent, getMemoryStore, nowIso } from "@/lib/memory/store";
import type {
  FrontstagePageName,
  RecommendationItemRecord,
  RecommendationRunRecord,
  SuggestionScene,
} from "@/lib/memory/types";

type CreateRunInput = {
  session_id: string;
  trace_id?: string;
  function_id?: string;
  telemetry_metadata?: Record<string, unknown>;
  customer_id: string;
  customer_name: string;
  scene: SuggestionScene;
  surface?: RecommendationRunRecord["surface"];
  generation_mode?: RecommendationRunRecord["generation_mode"];
  business_date?: RecommendationRunRecord["business_date"];
  snapshot_version?: RecommendationRunRecord["snapshot_version"];
  stale_reason?: RecommendationRunRecord["stale_reason"];
  page_name: FrontstagePageName;
  trigger_source: "auto" | "manual" | "assistant";
  campaign_id?: string;
  strategy_id?: string;
  expression_template_id?: string;
  prompt_version?: string;
  prompt_snapshot: string;
  response_snapshot?: string;
  candidate_sku_ids: string[];
  returned_sku_ids: string[];
  cart_amount_before?: number;
  cart_amount_after?: number;
  model_name: string;
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
};

type CreateRunItemsInput = Array<{
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  suggested_rank: number;
  reason: string;
  reason_tags: string[];
  action_type: "add_to_cart" | "adjust_qty" | "replace_item";
  effect_type?:
    | "replenishment"
    | "weekly_focus"
    | "threshold_reached"
    | "box_adjustment"
    | "pair_item";
}>;

function isOpenStatus(status: RecommendationItemRecord["final_status"]) {
  return status === "pending" || status === "viewed" || status === "explained";
}

function isAppliedStatus(status: RecommendationItemRecord["final_status"]) {
  return status === "applied" || status === "submitted_with_order";
}

export function refreshRunStatus(recommendationRunId: string) {
  const store = getMemoryStore();
  const run = store.recommendationRuns.find(
    (item) => item.recommendation_run_id === recommendationRunId,
  );
  if (!run) {
    return null;
  }

  const items = store.recommendationItems.filter(
    (item) => item.recommendation_run_id === recommendationRunId,
  );

  const openCount = items.filter((item) => isOpenStatus(item.final_status)).length;
  const appliedCount = items.filter((item) => isAppliedStatus(item.final_status)).length;
  const ignoredLikeCount = items.filter((item) =>
    ["ignored", "rejected", "expired"].includes(item.final_status),
  ).length;

  let nextStatus: RecommendationRunRecord["status"] = "generated";
  if (appliedCount > 0 && openCount > 0) {
    nextStatus = "partially_applied";
  } else if (appliedCount > 0 && openCount === 0) {
    nextStatus = "fully_applied";
  } else if (appliedCount === 0 && openCount === 0 && ignoredLikeCount > 0) {
    nextStatus = "ignored";
  } else {
    nextStatus = "generated";
  }

  run.status = nextStatus;
  run.updated_at = nowIso();
  return run;
}

export function expireOpenItemsForScene(input: {
  customer_id: string;
  scene: SuggestionScene;
}) {
  const store = getMemoryStore();
  const affectedRunIds = new Set<string>();
  const timestamp = nowIso();

  for (const item of store.recommendationItems) {
    if (item.customer_id !== input.customer_id || item.scene !== input.scene) {
      continue;
    }
    if (!isOpenStatus(item.final_status)) {
      continue;
    }
    item.final_status = "expired";
    item.updated_at = timestamp;
    affectedRunIds.add(item.recommendation_run_id);
  }

  affectedRunIds.forEach((runId) => {
    refreshRunStatus(runId);
  });
}

export function createRecommendationRun(input: CreateRunInput) {
  const store = getMemoryStore();
  const timestamp = nowIso();
  const run: RecommendationRunRecord = {
    recommendation_run_id: `reco_run_${randomUUID().replace(/-/g, "")}`,
    status: "generated",
    created_at: timestamp,
    updated_at: timestamp,
    ...input,
  };
  store.recommendationRuns.unshift(run);
  return run;
}

export function createRecommendationItems(
  run: RecommendationRunRecord,
  items: CreateRunItemsInput,
) {
  const store = getMemoryStore();
  const timestamp = nowIso();
  const records: RecommendationItemRecord[] = items.map((item) => ({
    recommendation_item_id: `reco_item_${randomUUID().replace(/-/g, "")}`,
    recommendation_run_id: run.recommendation_run_id,
    customer_id: run.customer_id,
    scene: run.scene,
    sku_id: item.sku_id,
    sku_name: item.sku_name,
    suggested_qty: item.suggested_qty,
    suggested_rank: item.suggested_rank,
    reason: item.reason,
    reason_tags: item.reason_tags,
    action_type: item.action_type,
    effect_type: item.effect_type,
    was_viewed: false,
    was_explained: false,
    was_applied: false,
    applied_by: "unknown",
    final_status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
  }));

  store.recommendationItems.unshift(...records);
  appendMetricEvent({
    customerId: run.customer_id,
    customerName: run.customer_name,
    eventType:
      run.scene === "weekly_focus" ? "weekly_focus_generated" : "recommendation_generated",
    scene: run.scene,
    payload: {
      recommendation_run_id: run.recommendation_run_id,
      returned_sku_ids: run.returned_sku_ids,
    },
  });
  return records;
}

export function markItemsExplained(input: {
  customer_id: string;
  scene: SuggestionScene;
  target_sku_ids: string[];
}) {
  const store = getMemoryStore();
  const targetSet = new Set(input.target_sku_ids);
  const timestamp = nowIso();
  const affectedRunIds = new Set<string>();

  const affectedItems = store.recommendationItems
    .filter(
      (item) =>
        item.customer_id === input.customer_id &&
        item.scene === input.scene &&
        targetSet.has(item.sku_id),
    )
    .sort((left, right) => right.created_at.localeCompare(left.created_at));

  const seenSku = new Set<string>();
  const updated: RecommendationItemRecord[] = [];

  for (const item of affectedItems) {
    if (seenSku.has(item.sku_id)) {
      continue;
    }
    seenSku.add(item.sku_id);

    item.was_viewed = true;
    item.was_explained = true;
    if (isOpenStatus(item.final_status)) {
      item.final_status = "explained";
    }
    item.updated_at = timestamp;
    affectedRunIds.add(item.recommendation_run_id);
    updated.push(item);
  }

  affectedRunIds.forEach((runId) => {
    refreshRunStatus(runId);
  });
  return updated;
}

export function markRecommendationItemDecision(input: {
  recommendation_item_id: string;
  decision: "ignored" | "rejected";
  rejected_reason?: string;
}) {
  const store = getMemoryStore();
  const item = store.recommendationItems.find(
    (record) => record.recommendation_item_id === input.recommendation_item_id,
  );
  if (!item) {
    return null;
  }
  if (item.final_status === "submitted_with_order") {
    return item;
  }
  item.was_viewed = true;
  item.final_status = input.decision;
  if (input.decision === "ignored") {
    item.ignored_at = nowIso();
  }
  if (input.decision === "rejected") {
    item.rejected_reason = input.rejected_reason ?? "manual_reject";
  }
  item.updated_at = nowIso();
  refreshRunStatus(item.recommendation_run_id);
  return item;
}

export function markRecommendationItemApplied(input: {
  recommendation_item_id: string;
  applied_qty: number;
  applied_by: "user" | "system" | "unknown";
}) {
  const store = getMemoryStore();
  const item = store.recommendationItems.find(
    (record) => record.recommendation_item_id === input.recommendation_item_id,
  );
  if (!item) {
    return { item: null, changed: false, reason: "not_found" as const };
  }

  if (item.final_status === "ignored" || item.final_status === "rejected") {
    return { item, changed: false, reason: "terminal_ignored_or_rejected" as const };
  }

  if (
    item.was_applied &&
    item.applied_qty === input.applied_qty &&
    (item.final_status === "applied" || item.final_status === "submitted_with_order")
  ) {
    return { item, changed: false, reason: "already_applied" as const };
  }

  item.was_viewed = true;
  item.was_applied = true;
  item.applied_qty = input.applied_qty;
  item.applied_at = nowIso();
  item.applied_by = input.applied_by;
  item.final_status = "applied";
  item.updated_at = nowIso();
  refreshRunStatus(item.recommendation_run_id);
  appendMetricEvent({
    customerId: item.customer_id,
    customerName: item.customer_id,
    eventType: "recommendation_applied",
    scene: item.scene,
    payload: {
      recommendation_item_id: item.recommendation_item_id,
      recommendation_run_id: item.recommendation_run_id,
      sku_id: item.sku_id,
      applied_qty: item.applied_qty,
    },
  });
  return { item, changed: true, reason: "applied" as const };
}

export function markSubmittedItemsForSession(input: {
  session_id: string;
  submitted_sku_ids: string[];
}) {
  const store = getMemoryStore();
  const submittedSkuSet = new Set(input.submitted_sku_ids);
  const affectedRunIds = new Set<string>();

  for (const item of store.recommendationItems) {
    const run = store.recommendationRuns.find(
      (record) => record.recommendation_run_id === item.recommendation_run_id,
    );
    if (!run || run.session_id !== input.session_id) {
      continue;
    }
    if (!item.was_applied) {
      continue;
    }
    if (!submittedSkuSet.has(item.sku_id)) {
      continue;
    }

    item.order_submitted_with_item = true;
    item.final_status = "submitted_with_order";
    item.updated_at = nowIso();
    affectedRunIds.add(item.recommendation_run_id);
  }

  for (const runId of affectedRunIds) {
    refreshRunStatus(runId);
  }
}
