import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateRecommendationSceneForCustomer } from "@/lib/domain/business-service";
import { getMemoryStore, resetMemoryStoreToSeed } from "@/lib/memory/store";
import type {
  GenerationJobEntity,
  RecommendationItemRecord,
  RecommendationRunRecord,
  RecommendationStrategyEntity,
} from "@/lib/memory/types";

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

const PURCHASE_SCENES = [
  "hot_sale_restock",
  "stockout_restock",
  "campaign_stockup",
] as const;

function toShanghaiBusinessDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((item) => item.type === "year")?.value;
  const month = parts.find((item) => item.type === "month")?.value;
  const day = parts.find((item) => item.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("无法生成 business_date");
  }
  return `${year}-${month}-${day}`;
}

function parseBusinessDateArg() {
  const arg = process.argv
    .slice(2)
    .find((item) => item.startsWith("--business-date="));
  const raw = arg?.split("=")[1]?.trim();
  if (!raw) {
    return toShanghaiBusinessDate();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`非法 business_date: ${raw}（应为 YYYY-MM-DD）`);
  }
  return raw;
}

function getJsonPath(filename: string) {
  return path.join(process.cwd(), "data", filename);
}

function readJsonFile<T>(filename: string): T {
  return JSON.parse(readFileSync(getJsonPath(filename), "utf-8")) as T;
}

function writeJsonFile(filename: string, data: unknown) {
  writeFileSync(getJsonPath(filename), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function ensurePurchaseRun(run: RecommendationRunRecord): asserts run is RecommendationRunRecord & {
  scene: "hot_sale_restock" | "stockout_restock" | "campaign_stockup";
  surface: "purchase";
  generation_mode: "precomputed";
  strategy_id: string;
  expression_template_id: string;
} {
  if (
    (run.scene !== "hot_sale_restock" &&
      run.scene !== "stockout_restock" &&
      run.scene !== "campaign_stockup") ||
    run.surface !== "purchase" ||
    run.generation_mode !== "precomputed" ||
    !run.strategy_id ||
    !run.expression_template_id
  ) {
    throw new Error(`run 不是有效的采购预计算记录: ${run.recommendation_run_id}`);
  }
}

function toSnapshotItem(item: RecommendationItemRecord): PurchaseSnapshotItemSeed {
  const result: PurchaseSnapshotItemSeed = {
    recommendation_item_id: item.recommendation_item_id,
    sku_id: item.sku_id,
    sku_name: item.sku_name,
    suggested_qty: item.suggested_qty,
    suggested_rank: item.suggested_rank,
    reason: item.reason,
    reason_tags: item.reason_tags,
    action_type: item.action_type,
    effect_type: item.effect_type,
    was_viewed: item.was_viewed,
    was_explained: item.was_explained,
    was_applied: item.was_applied,
    applied_by: item.applied_by,
    final_status: item.final_status,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
  if (item.applied_qty !== undefined) result.applied_qty = item.applied_qty;
  if (item.applied_at) result.applied_at = item.applied_at;
  if (item.ignored_at) result.ignored_at = item.ignored_at;
  if (item.rejected_reason) result.rejected_reason = item.rejected_reason;
  if (item.order_submitted_with_item !== undefined) {
    result.order_submitted_with_item = item.order_submitted_with_item;
  }
  return result;
}

function sortSnapshotRecords(records: PurchaseSnapshotRunSeed[]) {
  const sceneOrder = new Map(PURCHASE_SCENES.map((scene, index) => [scene, index]));
  return [...records].sort((left, right) => {
    if (left.customer_id !== right.customer_id) {
      return left.customer_id.localeCompare(right.customer_id);
    }
    const leftOrder = sceneOrder.get(left.scene) ?? 99;
    const rightOrder = sceneOrder.get(right.scene) ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.created_at.localeCompare(right.created_at);
  });
}

function getPurchaseStrategyIds(
  strategies: RecommendationStrategyEntity[],
): string[] {
  return [...strategies]
    .filter(
      (item) =>
        item.status === "active" &&
        (item.scene === "hot_sale_restock" ||
          item.scene === "stockout_restock" ||
          item.scene === "campaign_stockup"),
    )
    .sort((left, right) => left.priority - right.priority)
    .map((item) => item.strategy_id);
}

async function main() {
  const businessDate = parseBusinessDateArg();
  const preparedAt = new Date().toISOString();
  const batchId = `batch_snapshot_${businessDate.replaceAll("-", "")}`;
  const snapshotVersion = `purchase_snapshot_${businessDate}.v1`;
  const promptVersion = `${businessDate}.snapshot.runtime`;

  resetMemoryStoreToSeed();
  const store = getMemoryStore();
  const activeDealers = [...store.dealers]
    .filter((item) => item.status === "active")
    .sort((left, right) => left.customer_id.localeCompare(right.customer_id));
  const targetDealerIds = activeDealers.map((item) => item.customer_id);
  if (targetDealerIds.length === 0) {
    throw new Error("没有可用于预计算的 active 经销商");
  }

  const generatedRunIds: string[] = [];
  for (const dealerId of targetDealerIds) {
    for (const scene of PURCHASE_SCENES) {
      const result = await generateRecommendationSceneForCustomer({
        session_id: `session_snapshot_${dealerId}_${scene}_${Date.now()}`,
        customer_id: dealerId,
        scene,
        trigger_source: "assistant",
        page_name: "/purchase",
      });
      generatedRunIds.push(result.summary.run_id);
    }
  }

  const runMap = new Map(
    store.recommendationRuns.map((item) => [item.recommendation_run_id, item]),
  );
  const productPriceMap = new Map(
    store.products.map((item) => [item.sku_id, item.price_per_case]),
  );

  const snapshotRuns: PurchaseSnapshotRunSeed[] = generatedRunIds.map((runId) => {
    const run = runMap.get(runId);
    if (!run) {
      throw new Error(`run 不存在: ${runId}`);
    }
    ensurePurchaseRun(run);
    const runItems = store.recommendationItems
      .filter((item) => item.recommendation_run_id === run.recommendation_run_id)
      .sort((left, right) => left.suggested_rank - right.suggested_rank);

    const returnedAmount = runItems.reduce((sum, item) => {
      const unitPrice = productPriceMap.get(item.sku_id) ?? 0;
      return sum + unitPrice * item.suggested_qty;
    }, 0);
    const cartAmountBefore = run.cart_amount_before ?? 0;
    const cartAmountAfter = run.cart_amount_after ?? cartAmountBefore + returnedAmount;

    return {
      recommendation_run_id: run.recommendation_run_id,
      batch_id: batchId,
      trace_id: run.trace_id ?? `trace_snapshot_${run.recommendation_run_id}`,
      customer_id: run.customer_id,
      customer_name: run.customer_name,
      scene: run.scene,
      surface: "purchase",
      generation_mode: "precomputed",
      business_date: businessDate,
      snapshot_version: snapshotVersion,
      campaign_id: run.campaign_id,
      strategy_id: run.strategy_id,
      expression_template_id: run.expression_template_id,
      prompt_version: promptVersion,
      prompt_snapshot: run.prompt_snapshot,
      response_snapshot: run.response_snapshot ?? JSON.stringify({ elements: [] }, null, 2),
      candidate_sku_ids: run.candidate_sku_ids,
      returned_sku_ids: run.returned_sku_ids,
      cart_amount_before: cartAmountBefore,
      cart_amount_after: cartAmountAfter,
      model_name: run.model_name,
      model_latency_ms: run.model_latency_ms,
      input_tokens: run.input_tokens ?? 0,
      output_tokens: run.output_tokens ?? 0,
      status: run.status,
      created_at: run.created_at,
      updated_at: run.updated_at,
      items: runItems.map(toSnapshotItem),
    };
  });

  const sortedSnapshotRuns = sortSnapshotRecords(snapshotRuns);
  writeJsonFile("purchase-snapshots.json", sortedSnapshotRuns);

  const existingJobs = readJsonFile<GenerationJobEntity[]>("generation-jobs.json");
  const purchaseStrategyIds = getPurchaseStrategyIds(store.recommendationStrategies);
  const firstJob = existingJobs[0];
  const updatedJob: GenerationJobEntity = {
    job_id: firstJob?.job_id ?? `job_snapshot_${businessDate}`,
    job_name: `${businessDate} 采购预计算建议单生成`,
    business_date: businessDate,
    target_dealer_ids: targetDealerIds,
    target_segment_ids: firstJob?.target_segment_ids ?? [],
    strategy_ids: purchaseStrategyIds,
    publish_mode: firstJob?.publish_mode ?? "manual",
    status: "completed",
    publication_status: "published",
    precheck_summary: `快照已准备：覆盖 ${targetDealerIds.length} 个经销商，生成 ${sortedSnapshotRuns.length} 条采购预计算建议并发布。`,
    last_precheck_at: preparedAt,
    last_sample_batch_id: batchId,
    last_batch_id: batchId,
    published_batch_id: batchId,
    published_at: preparedAt,
    created_at: firstJob?.created_at ?? preparedAt,
    updated_at: preparedAt,
  };
  const nextJobs = [updatedJob, ...existingJobs.slice(1)];
  writeJsonFile("generation-jobs.json", nextJobs);

  console.log(
    `[demo:prepare-snapshots] 已生成 ${sortedSnapshotRuns.length} 条 purchase snapshot run，batch=${batchId}，business_date=${businessDate}`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[demo:prepare-snapshots] 失败: ${message}`);
  process.exitCode = 1;
});
