import { randomUUID } from "node:crypto";

import {
  filterSortAndPaginate,
  type ListQuery,
} from "@/lib/admin/list-query";
import type {
  ListResult,
  RecommendationBatchFilters,
  RecommendationRecordFilters,
} from "@/lib/admin/types";
import { getCartBySession } from "@/lib/cart/service";
import {
  generateCartOptimizationForSession,
  generateRecommendationsForCustomer,
  generateRecommendationSceneForCustomer,
} from "@/lib/domain/business-service";
import { matchCampaignsForDealer } from "@/lib/domain/recommendation-rules";
import {
  appendAuditLog,
  getMemoryStore,
  nowIso,
  resetMemoryStoreToSeed,
} from "@/lib/memory/store";
import type {
  ActivityHighlight,
  BundleTemplate,
  BundleTemplateItem,
  CampaignEntity,
  DealerEntity,
  DealerSegmentEntity,
  ExpressionTemplateEntity,
  GenerationJobEntity,
  GlobalRuleEntity,
  ProductEntity,
  ProductPoolEntity,
  PromptConfigEntity,
  RecommendationBatchRecord,
  RecommendationItemRecord,
  RecommendationRunRecord,
  RecommendationStrategyEntity,
  RecoverySnapshotRecord,
  PublishedSuggestionsCartSummary,
  RuleConfigEntity,
  SuggestionScene,
  TemplateReferenceItem,
} from "@/lib/memory/types";

type UpsertInput<T> = Omit<T, "created_at" | "updated_at">;

type GenerationJobUpsertInput = Omit<
  UpsertInput<GenerationJobEntity>,
  | "publication_status"
  | "last_precheck_at"
  | "last_sample_batch_id"
  | "last_batch_id"
  | "published_batch_id"
  | "published_at"
> &
  Partial<
    Pick<
      GenerationJobEntity,
      | "publication_status"
      | "last_precheck_at"
      | "last_sample_batch_id"
      | "last_batch_id"
      | "published_batch_id"
      | "published_at"
    >
  >;

type RecommendationBatchUpsertInput = Omit<
  UpsertInput<RecommendationBatchRecord>,
  "job_id" | "publication_status"
> &
  Partial<Pick<RecommendationBatchRecord, "job_id" | "publication_status">>;

export type PublishedSuggestionsPayload = {
  bundleTemplates: BundleTemplate[];
  activityHighlights: ActivityHighlight[];
  cartSummary: PublishedSuggestionsCartSummary;
  summary: {
    published: boolean;
    job_id?: string;
    batch_id?: string;
    published_at?: string;
    trace_id?: string;
  };
};

export type GenerationJobActionResult = {
  job: GenerationJobEntity;
  batch?: RecommendationBatchRecord;
  summary: string;
  issues?: string[];
  sampled_customer_ids?: string[];
  generated_run_ids?: string[];
};

export class AdminServiceError extends Error {
  code: string;
  status: number;
  fieldErrors?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    status: number,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function notFound(message: string): never {
  throw new AdminServiceError("NOT_FOUND", message, 404);
}

function conflict(message: string): never {
  throw new AdminServiceError("CONFLICT", message, 409);
}

function validation(
  fieldErrors: Record<string, string>,
  message = "参数校验失败",
): never {
  throw new AdminServiceError("VALIDATION_ERROR", message, 400, fieldErrors);
}

function nowPair() {
  const now = nowIso();
  return { created_at: now, updated_at: now };
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
  const pick = (type: ExpressionTemplateEntity["template_type"]) =>
    templates.find((item) => item.template_type === type && item.status === "active");

  const bundle = pick("bundle_explanation");
  const topup = pick("topup_explanation");
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

function refreshDerivedConfigs() {
  const store = getMemoryStore();
  store.rules = toRuleConfig(store.globalRules);
  store.promptConfig = toPromptConfig(store.expressionTemplates);
}

function ensureSkuExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const skuSet = new Set(store.products.map((item) => item.sku_id));
  const missing = input.filter((id) => !skuSet.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下 SKU 不存在: ${missing.join(", ")}`,
    });
  }
}

function ensureDealerExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const set = new Set(store.dealers.map((item) => item.customer_id));
  const missing = input.filter((id) => !set.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下经销商不存在: ${missing.join(", ")}`,
    });
  }
}

function ensureSegmentExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const set = new Set(store.dealerSegments.map((item) => item.segment_id));
  const missing = input.filter((id) => !set.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下分群不存在: ${missing.join(", ")}`,
    });
  }
}

function ensurePoolExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const set = new Set(store.productPools.map((item) => item.pool_id));
  const missing = input.filter((id) => !set.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下商品池不存在: ${missing.join(", ")}`,
    });
  }
}

function ensureCampaignExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const set = new Set(store.campaigns.map((item) => item.campaign_id));
  const missing = input.filter((id) => !set.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下活动不存在: ${missing.join(", ")}`,
    });
  }
}

function ensureExpressionTemplateExists(id: string) {
  const store = getMemoryStore();
  const exists = store.expressionTemplates.some(
    (item) => item.expression_template_id === id,
  );
  if (!exists) {
    validation({
      expression_template_id: `表达模板不存在: ${id}`,
    });
  }
}

function ensureStrategyExists(input: string[], fieldName: string) {
  const store = getMemoryStore();
  const set = new Set(store.recommendationStrategies.map((item) => item.strategy_id));
  const missing = input.filter((id) => !set.has(id));
  if (missing.length > 0) {
    validation({
      [fieldName]: `以下策略不存在: ${missing.join(", ")}`,
    });
  }
}

function resolveTargetDealerIds(job: GenerationJobEntity): string[] {
  const store = getMemoryStore();
  const allIds = new Set(job.target_dealer_ids);
  for (const segmentId of job.target_segment_ids) {
    const segment = store.dealerSegments.find((item) => item.segment_id === segmentId);
    if (!segment) {
      continue;
    }
    for (const dealerId of segment.dealer_ids) {
      allIds.add(dealerId);
    }
  }
  return Array.from(allIds);
}

function pickConfigSnapshotId() {
  const store = getMemoryStore();
  const latest = [...store.recoverySnapshots].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  )[0];
  return latest?.snapshot_id ?? "snapshot_seed_default";
}

function createBatchId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function appendAudit(input: Omit<Parameters<typeof appendAuditLog>[0], "summary"> & { summary: string }) {
  appendAuditLog(input);
}

const PURCHASE_PRECOMPUTED_SCENES = new Set<SuggestionScene>([
  "hot_sale_restock",
  "stockout_restock",
  "campaign_stockup",
  "daily_recommendation",
  "weekly_focus",
]);

function isPurchasePrecomputedRun(run: RecommendationRunRecord) {
  return (
    run.surface === "purchase" &&
    run.generation_mode === "precomputed" &&
    PURCHASE_PRECOMPUTED_SCENES.has(run.scene)
  );
}

function summarizeWithSnapshotState(baseSummary: string, staleCount: number) {
  if (staleCount <= 0) {
    return baseSummary;
  }
  return `${baseSummary}；快照状态：已过期（${staleCount} 条待重生成）`;
}

function stripSnapshotStateSuffix(summary: string) {
  const marker = "；快照状态：";
  const markerIndex = summary.indexOf(marker);
  if (markerIndex < 0) {
    return summary;
  }
  return summary.slice(0, markerIndex);
}

function getPurchaseRunStaleCountForJob(job: GenerationJobEntity) {
  const store = getMemoryStore();
  const targetBatchId =
    job.published_batch_id ?? job.last_batch_id ?? job.last_sample_batch_id;
  if (!targetBatchId) {
    return 0;
  }
  const batch = store.recommendationBatches.find((item) => item.batch_id === targetBatchId);
  if (!batch) {
    return 0;
  }
  const runMap = new Map(
    store.recommendationRuns.map((item) => [item.recommendation_run_id, item]),
  );
  return batch.related_run_ids
    .map((runId) => runMap.get(runId))
    .filter((item): item is RecommendationRunRecord => Boolean(item))
    .filter((run) => isPurchasePrecomputedRun(run) && Boolean(run.stale_reason)).length;
}

function syncGenerationJobSnapshotState() {
  const store = getMemoryStore();
  for (const job of store.generationJobs) {
    const staleCount = getPurchaseRunStaleCountForJob(job);
    const baseSummary = stripSnapshotStateSuffix(job.precheck_summary || "").trim();
    const fallbackSummary = baseSummary || `任务 ${job.job_name} 已发布采购快照`;
    job.precheck_summary = summarizeWithSnapshotState(fallbackSummary, staleCount);
  }
}

function markPurchaseRunsStale(input: {
  reason: string;
  predicate?: (run: RecommendationRunRecord) => boolean;
}) {
  const store = getMemoryStore();
  const updatedAt = nowIso();
  let staleCount = 0;

  for (const run of store.recommendationRuns) {
    if (!isPurchasePrecomputedRun(run)) {
      continue;
    }
    if (input.predicate && !input.predicate(run)) {
      continue;
    }
    run.stale_reason = input.reason;
    run.updated_at = updatedAt;
    staleCount += 1;
  }

  if (staleCount > 0) {
    syncGenerationJobSnapshotState();
  }
  return staleCount;
}

function shouldStalePurchaseForExpressionTemplate(
  template: Pick<ExpressionTemplateEntity, "scene">,
) {
  return template.scene === "bundle" || template.scene === "all";
}

function findById<T>(
  items: T[],
  matcher: (item: T) => boolean,
  notFoundMessage: string,
): T {
  const item = items.find(matcher);
  if (!item) {
    notFound(notFoundMessage);
  }
  return item;
}

function deleteWithStatusGuard<T extends { status: string; updated_at: string }>(
  item: T,
  idField: string,
) {
  if (item.status === "inactive") {
    conflict(`${idField} 已停用`);
  }
  item.status = "inactive";
  item.updated_at = nowIso();
  return item;
}

export function listProducts(query: ListQuery): ListResult<ProductEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.products, {
    query,
    searchFields: ["sku_id", "sku_name", "brand", "category", "spec", "tags"],
    statusField: "status",
    defaultSortBy: "display_order",
  });
}

export function getProductById(id: string) {
  const store = getMemoryStore();
  return store.products.find((item) => item.sku_id === id) ?? null;
}

export function createProduct(input: UpsertInput<ProductEntity>) {
  const store = getMemoryStore();
  const exists = store.products.some((item) => item.sku_id === input.sku_id);
  if (exists) {
    conflict(`商品已存在: ${input.sku_id}`);
  }
  ensureSkuExists(input.pair_items, "pair_items");
  const created: ProductEntity = { ...input, ...nowPair() };
  store.products.push(created);
  const staleCount = markPurchaseRunsStale({
    reason: `商品主数据变更：${created.sku_id}`,
  });
  appendAudit({
    entity_type: "product",
    entity_id: created.sku_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增商品 ${created.sku_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增商品 ${created.sku_name}`,
  });
  return created;
}

export function updateProduct(id: string, input: Partial<UpsertInput<ProductEntity>>) {
  const store = getMemoryStore();
  const item = findById(store.products, (record) => record.sku_id === id, "商品不存在");
  if (input.pair_items) {
    ensureSkuExists(input.pair_items, "pair_items");
  }
  Object.assign(item, input, { updated_at: nowIso() });
  const staleCount = markPurchaseRunsStale({
    reason: `商品主数据变更：${item.sku_id}`,
  });
  appendAudit({
    entity_type: "product",
    entity_id: item.sku_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新商品 ${item.sku_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新商品 ${item.sku_name}`,
  });
  return item;
}

export function softDeleteProduct(id: string) {
  const store = getMemoryStore();
  const item = findById(store.products, (record) => record.sku_id === id, "商品不存在");
  deleteWithStatusGuard(item, "商品");
  const staleCount = markPurchaseRunsStale({
    reason: `商品停用：${item.sku_id}`,
  });
  appendAudit({
    entity_type: "product",
    entity_id: item.sku_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用商品 ${item.sku_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用商品 ${item.sku_name}`,
  });
  return item;
}

export function listDealers(query: ListQuery): ListResult<DealerEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.dealers, {
    query,
    searchFields: [
      "customer_id",
      "customer_name",
      "city",
      "customer_type",
      "channel_type",
      "frequent_items",
      "forbidden_items",
    ],
    statusField: "status",
    defaultSortBy: "customer_name",
  });
}

export function getDealerById(id: string) {
  const store = getMemoryStore();
  return store.dealers.find((item) => item.customer_id === id) ?? null;
}

export function createDealer(input: UpsertInput<DealerEntity>) {
  const store = getMemoryStore();
  const exists = store.dealers.some((item) => item.customer_id === input.customer_id);
  if (exists) {
    conflict(`经销商已存在: ${input.customer_id}`);
  }
  ensureSkuExists(input.frequent_items, "frequent_items");
  ensureSkuExists(input.forbidden_items, "forbidden_items");
  const overlap = input.frequent_items.filter((item) =>
    input.forbidden_items.includes(item),
  );
  if (overlap.length > 0) {
    validation({
      forbidden_items: `禁推与常购冲突: ${overlap.join(", ")}`,
    });
  }

  const created: DealerEntity = { ...input, ...nowPair() };
  store.dealers.push(created);
  const staleCount = markPurchaseRunsStale({
    reason: `经销商主数据变更：${created.customer_id}`,
  });
  appendAudit({
    entity_type: "dealer",
    entity_id: created.customer_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增经销商 ${created.customer_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增经销商 ${created.customer_name}`,
  });
  return created;
}

export function updateDealer(id: string, input: Partial<UpsertInput<DealerEntity>>) {
  const store = getMemoryStore();
  const item = findById(store.dealers, (record) => record.customer_id === id, "经销商不存在");
  if (input.frequent_items) {
    ensureSkuExists(input.frequent_items, "frequent_items");
  }
  if (input.forbidden_items) {
    ensureSkuExists(input.forbidden_items, "forbidden_items");
  }
  const nextFrequent = input.frequent_items ?? item.frequent_items;
  const nextForbidden = input.forbidden_items ?? item.forbidden_items;
  const overlap = nextFrequent.filter((skuId) => nextForbidden.includes(skuId));
  if (overlap.length > 0) {
    validation({
      forbidden_items: `禁推与常购冲突: ${overlap.join(", ")}`,
    });
  }
  Object.assign(item, input, { updated_at: nowIso() });
  const staleCount = markPurchaseRunsStale({
    reason: `经销商主数据变更：${item.customer_id}`,
    predicate: (run) => run.customer_id === item.customer_id,
  });
  appendAudit({
    entity_type: "dealer",
    entity_id: item.customer_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新经销商 ${item.customer_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新经销商 ${item.customer_name}`,
  });
  return item;
}

export function softDeleteDealer(id: string) {
  const store = getMemoryStore();
  const item = findById(store.dealers, (record) => record.customer_id === id, "经销商不存在");
  deleteWithStatusGuard(item, "经销商");
  const staleCount = markPurchaseRunsStale({
    reason: `经销商停用：${item.customer_id}`,
    predicate: (run) => run.customer_id === item.customer_id,
  });
  appendAudit({
    entity_type: "dealer",
    entity_id: item.customer_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用经销商 ${item.customer_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用经销商 ${item.customer_name}`,
  });
  return item;
}

export function listCampaigns(query: ListQuery): ListResult<CampaignEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.campaigns, {
    query,
    searchFields: [
      "campaign_id",
      "campaign_name",
      "week_id",
      "weekly_focus_items",
      "product_pool_ids",
      "target_dealer_ids",
      "target_segment_ids",
      "target_customer_types",
    ],
    statusField: "status",
    defaultSortBy: "week_id",
  });
}

export function getCampaignById(id: string) {
  const store = getMemoryStore();
  return store.campaigns.find((item) => item.campaign_id === id) ?? null;
}

export function createCampaign(input: UpsertInput<CampaignEntity>) {
  const store = getMemoryStore();
  const exists = store.campaigns.some((item) => item.campaign_id === input.campaign_id);
  if (exists) {
    conflict(`活动已存在: ${input.campaign_id}`);
  }
  ensureSkuExists(input.weekly_focus_items, "weekly_focus_items");
  if (input.product_pool_ids && input.product_pool_ids.length > 0) {
    ensurePoolExists(input.product_pool_ids, "product_pool_ids");
  }
  if (input.target_dealer_ids && input.target_dealer_ids.length > 0) {
    ensureDealerExists(input.target_dealer_ids, "target_dealer_ids");
  }
  if (input.target_segment_ids && input.target_segment_ids.length > 0) {
    ensureSegmentExists(input.target_segment_ids, "target_segment_ids");
  }
  const created: CampaignEntity = { ...input, ...nowPair() };
  store.campaigns.push(created);
  const staleCount = markPurchaseRunsStale({
    reason: `活动配置变更：${created.campaign_id}`,
    predicate: (run) => run.scene === "campaign_stockup" || run.scene === "weekly_focus",
  });
  appendAudit({
    entity_type: "campaign",
    entity_id: created.campaign_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增活动 ${created.campaign_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增活动 ${created.campaign_name}`,
  });
  return created;
}

export function updateCampaign(id: string, input: Partial<UpsertInput<CampaignEntity>>) {
  const store = getMemoryStore();
  const item = findById(store.campaigns, (record) => record.campaign_id === id, "活动不存在");
  if (input.weekly_focus_items) {
    ensureSkuExists(input.weekly_focus_items, "weekly_focus_items");
  }
  if (input.product_pool_ids) {
    ensurePoolExists(input.product_pool_ids, "product_pool_ids");
  }
  if (input.target_dealer_ids) {
    ensureDealerExists(input.target_dealer_ids, "target_dealer_ids");
  }
  if (input.target_segment_ids) {
    ensureSegmentExists(input.target_segment_ids, "target_segment_ids");
  }
  Object.assign(item, input, { updated_at: nowIso() });
  const staleCount = markPurchaseRunsStale({
    reason: `活动配置变更：${item.campaign_id}`,
    predicate: (run) => run.scene === "campaign_stockup" || run.scene === "weekly_focus",
  });
  appendAudit({
    entity_type: "campaign",
    entity_id: item.campaign_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新活动 ${item.campaign_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新活动 ${item.campaign_name}`,
  });
  return item;
}

export function softDeleteCampaign(id: string) {
  const store = getMemoryStore();
  const item = findById(store.campaigns, (record) => record.campaign_id === id, "活动不存在");
  deleteWithStatusGuard(item, "活动");
  const staleCount = markPurchaseRunsStale({
    reason: `活动停用：${item.campaign_id}`,
    predicate: (run) => run.scene === "campaign_stockup" || run.scene === "weekly_focus",
  });
  appendAudit({
    entity_type: "campaign",
    entity_id: item.campaign_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用活动 ${item.campaign_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用活动 ${item.campaign_name}`,
  });
  return item;
}

export function listDealerSegments(query: ListQuery): ListResult<DealerSegmentEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.dealerSegments, {
    query,
    searchFields: [
      "segment_id",
      "segment_name",
      "description",
      "city_list",
      "customer_types",
      "channel_types",
      "dealer_ids",
    ],
    statusField: "status",
    defaultSortBy: "segment_name",
  });
}

export function getDealerSegmentById(id: string) {
  const store = getMemoryStore();
  return store.dealerSegments.find((item) => item.segment_id === id) ?? null;
}

export function createDealerSegment(input: UpsertInput<DealerSegmentEntity>) {
  const store = getMemoryStore();
  const exists = store.dealerSegments.some((item) => item.segment_id === input.segment_id);
  if (exists) {
    conflict(`经销商分群已存在: ${input.segment_id}`);
  }
  ensureDealerExists(input.dealer_ids, "dealer_ids");
  const created: DealerSegmentEntity = { ...input, ...nowPair() };
  store.dealerSegments.push(created);
  const staleCount = markPurchaseRunsStale({
    reason: `经销商分群变更：${created.segment_id}`,
  });
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: created.segment_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增分群 ${created.segment_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增分群 ${created.segment_name}`,
  });
  return created;
}

export function updateDealerSegment(
  id: string,
  input: Partial<UpsertInput<DealerSegmentEntity>>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.dealerSegments,
    (record) => record.segment_id === id,
    "经销商分群不存在",
  );
  if (input.dealer_ids) {
    ensureDealerExists(input.dealer_ids, "dealer_ids");
  }
  Object.assign(item, input, { updated_at: nowIso() });
  const staleCount = markPurchaseRunsStale({
    reason: `经销商分群变更：${item.segment_id}`,
  });
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: item.segment_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新分群 ${item.segment_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新分群 ${item.segment_name}`,
  });
  return item;
}

export function softDeleteDealerSegment(id: string) {
  const store = getMemoryStore();
  const item = findById(
    store.dealerSegments,
    (record) => record.segment_id === id,
    "经销商分群不存在",
  );
  deleteWithStatusGuard(item, "经销商分群");
  const staleCount = markPurchaseRunsStale({
    reason: `经销商分群停用：${item.segment_id}`,
  });
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: item.segment_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用分群 ${item.segment_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用分群 ${item.segment_name}`,
  });
  return item;
}

export function listProductPools(query: ListQuery): ListResult<ProductPoolEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.productPools, {
    query,
    searchFields: ["pool_id", "pool_name", "pool_type", "description", "sku_ids"],
    statusField: "status",
    defaultSortBy: "pool_name",
  });
}

export function getProductPoolById(id: string) {
  const store = getMemoryStore();
  return store.productPools.find((item) => item.pool_id === id) ?? null;
}

export function createProductPool(input: UpsertInput<ProductPoolEntity>) {
  const store = getMemoryStore();
  const exists = store.productPools.some((item) => item.pool_id === input.pool_id);
  if (exists) {
    conflict(`商品池已存在: ${input.pool_id}`);
  }
  ensureSkuExists(input.sku_ids, "sku_ids");
  ensureSkuExists(input.pair_sku_ids, "pair_sku_ids");
  const created: ProductPoolEntity = { ...input, ...nowPair() };
  store.productPools.push(created);
  const staleCount = markPurchaseRunsStale({
    reason: `商品池配置变更：${created.pool_id}`,
  });
  appendAudit({
    entity_type: "product_pool",
    entity_id: created.pool_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增商品池 ${created.pool_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增商品池 ${created.pool_name}`,
  });
  return created;
}

export function updateProductPool(id: string, input: Partial<UpsertInput<ProductPoolEntity>>) {
  const store = getMemoryStore();
  const item = findById(store.productPools, (record) => record.pool_id === id, "商品池不存在");
  if (input.sku_ids) {
    ensureSkuExists(input.sku_ids, "sku_ids");
  }
  if (input.pair_sku_ids) {
    ensureSkuExists(input.pair_sku_ids, "pair_sku_ids");
  }
  Object.assign(item, input, { updated_at: nowIso() });
  const staleCount = markPurchaseRunsStale({
    reason: `商品池配置变更：${item.pool_id}`,
  });
  appendAudit({
    entity_type: "product_pool",
    entity_id: item.pool_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新商品池 ${item.pool_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新商品池 ${item.pool_name}`,
  });
  return item;
}

export function softDeleteProductPool(id: string) {
  const store = getMemoryStore();
  const item = findById(store.productPools, (record) => record.pool_id === id, "商品池不存在");
  deleteWithStatusGuard(item, "商品池");
  const staleCount = markPurchaseRunsStale({
    reason: `商品池停用：${item.pool_id}`,
  });
  appendAudit({
    entity_type: "product_pool",
    entity_id: item.pool_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用商品池 ${item.pool_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用商品池 ${item.pool_name}`,
  });
  return item;
}

type RecommendationStrategyListFilters = {
  sceneGroup?: "purchase" | "all";
};

export function listRecommendationStrategies(
  query: ListQuery,
  filters: RecommendationStrategyListFilters = {},
): ListResult<RecommendationStrategyEntity> {
  const store = getMemoryStore();
  let records = [...store.recommendationStrategies];
  if (filters.sceneGroup === "purchase") {
    records = records.filter(
      (item) =>
        item.scene === "hot_sale_restock" ||
        item.scene === "stockout_restock" ||
        item.scene === "campaign_stockup",
    );
  }
  return filterSortAndPaginate(records, {
    query,
    searchFields: [
      "strategy_id",
      "strategy_name",
      "scene",
      "target_dealer_ids",
      "dealer_segment_ids",
      "product_pool_ids",
      "candidate_sku_ids",
    ],
    statusField: "status",
    defaultSortBy: "priority",
  });
}

export function getRecommendationStrategyById(id: string) {
  const store = getMemoryStore();
  return store.recommendationStrategies.find((item) => item.strategy_id === id) ?? null;
}

function validateStrategyRelations(input: Partial<UpsertInput<RecommendationStrategyEntity>>) {
  if (input.target_dealer_ids) {
    ensureDealerExists(input.target_dealer_ids, "target_dealer_ids");
  }
  if (input.dealer_segment_ids) {
    ensureSegmentExists(input.dealer_segment_ids, "dealer_segment_ids");
  }
  if (input.product_pool_ids) {
    ensurePoolExists(input.product_pool_ids, "product_pool_ids");
  }
  if (input.campaign_ids) {
    ensureCampaignExists(input.campaign_ids, "campaign_ids");
  }
  if (input.candidate_sku_ids) {
    ensureSkuExists(input.candidate_sku_ids, "candidate_sku_ids");
  }
  if (input.expression_template_id) {
    ensureExpressionTemplateExists(input.expression_template_id);
  }
  if (input.reference_items) {
    ensureSkuExists(
      input.reference_items.map((item) => item.sku_id),
      "reference_items",
    );
  }
}

export function createRecommendationStrategy(
  input: UpsertInput<RecommendationStrategyEntity>,
) {
  const store = getMemoryStore();
  const exists = store.recommendationStrategies.some(
    (item) => item.strategy_id === input.strategy_id,
  );
  if (exists) {
    conflict(`推荐策略已存在: ${input.strategy_id}`);
  }
  validateStrategyRelations(input);
  const created: RecommendationStrategyEntity = { ...input, ...nowPair() };
  store.recommendationStrategies.push(created);
  refreshDerivedConfigs();
  const staleCount = markPurchaseRunsStale({
    reason: `推荐策略变更：${created.strategy_id}`,
    predicate: (run) => run.scene === created.scene,
  });
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: created.strategy_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增推荐策略 ${created.strategy_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增推荐策略 ${created.strategy_name}`,
  });
  return created;
}

export function updateRecommendationStrategy(
  id: string,
  input: Partial<UpsertInput<RecommendationStrategyEntity>>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.recommendationStrategies,
    (record) => record.strategy_id === id,
    "推荐策略不存在",
  );
  validateStrategyRelations(input);
  Object.assign(item, input, { updated_at: nowIso() });
  refreshDerivedConfigs();
  const staleCount = markPurchaseRunsStale({
    reason: `推荐策略变更：${item.strategy_id}`,
    predicate: (run) => run.scene === item.scene,
  });
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: item.strategy_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新推荐策略 ${item.strategy_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新推荐策略 ${item.strategy_name}`,
  });
  return item;
}

export function softDeleteRecommendationStrategy(id: string) {
  const store = getMemoryStore();
  const item = findById(
    store.recommendationStrategies,
    (record) => record.strategy_id === id,
    "推荐策略不存在",
  );
  deleteWithStatusGuard(item, "推荐策略");
  refreshDerivedConfigs();
  const staleCount = markPurchaseRunsStale({
    reason: `推荐策略停用：${item.strategy_id}`,
    predicate: (run) => run.scene === item.scene,
  });
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: item.strategy_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用推荐策略 ${item.strategy_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用推荐策略 ${item.strategy_name}`,
  });
  return item;
}

export function listExpressionTemplates(
  query: ListQuery,
): ListResult<ExpressionTemplateEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.expressionTemplates, {
    query,
    searchFields: [
      "expression_template_id",
      "expression_template_name",
      "template_type",
      "scene",
      "tone",
      "style_hint",
    ],
    statusField: "status",
    defaultSortBy: "expression_template_name",
  });
}

export function getExpressionTemplateById(id: string) {
  const store = getMemoryStore();
  return (
    store.expressionTemplates.find((item) => item.expression_template_id === id) ?? null
  );
}

export function createExpressionTemplate(
  input: UpsertInput<ExpressionTemplateEntity>,
) {
  const store = getMemoryStore();
  const exists = store.expressionTemplates.some(
    (item) => item.expression_template_id === input.expression_template_id,
  );
  if (exists) {
    conflict(`表达模板已存在: ${input.expression_template_id}`);
  }
  const created: ExpressionTemplateEntity = { ...input, ...nowPair() };
  store.expressionTemplates.push(created);
  refreshDerivedConfigs();
  const staleCount = shouldStalePurchaseForExpressionTemplate(created)
    ? markPurchaseRunsStale({
        reason: `表达模板变更：${created.expression_template_id}`,
      })
    : 0;
  appendAudit({
    entity_type: "expression_template",
    entity_id: created.expression_template_id,
    action: "create",
    summary:
      staleCount > 0
        ? `新增表达模板 ${created.expression_template_name}，标记 ${staleCount} 条采购建议待重生成`
        : `新增表达模板 ${created.expression_template_name}`,
  });
  return created;
}

export function updateExpressionTemplate(
  id: string,
  input: Partial<UpsertInput<ExpressionTemplateEntity>>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.expressionTemplates,
    (record) => record.expression_template_id === id,
    "表达模板不存在",
  );
  Object.assign(item, input, { updated_at: nowIso() });
  refreshDerivedConfigs();
  const staleCount = shouldStalePurchaseForExpressionTemplate(item)
    ? markPurchaseRunsStale({
        reason: `表达模板变更：${item.expression_template_id}`,
      })
    : 0;
  appendAudit({
    entity_type: "expression_template",
    entity_id: item.expression_template_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新表达模板 ${item.expression_template_name}，标记 ${staleCount} 条采购建议待重生成`
        : `更新表达模板 ${item.expression_template_name}`,
  });
  return item;
}

export function softDeleteExpressionTemplate(id: string) {
  const store = getMemoryStore();
  const item = findById(
    store.expressionTemplates,
    (record) => record.expression_template_id === id,
    "表达模板不存在",
  );
  deleteWithStatusGuard(item, "表达模板");
  refreshDerivedConfigs();
  const staleCount = shouldStalePurchaseForExpressionTemplate(item)
    ? markPurchaseRunsStale({
        reason: `表达模板停用：${item.expression_template_id}`,
      })
    : 0;
  appendAudit({
    entity_type: "expression_template",
    entity_id: item.expression_template_id,
    action: "toggle",
    summary:
      staleCount > 0
        ? `停用表达模板 ${item.expression_template_name}，标记 ${staleCount} 条采购建议待重生成`
        : `停用表达模板 ${item.expression_template_name}`,
  });
  return item;
}

export function getGlobalRules() {
  const store = getMemoryStore();
  return store.globalRules;
}

export function updateGlobalRules(input: UpsertInput<GlobalRuleEntity>) {
  const store = getMemoryStore();
  store.globalRules = {
    ...store.globalRules,
    ...input,
    global_rule_id: store.globalRules.global_rule_id || input.global_rule_id,
    updated_at: nowIso(),
  };
  refreshDerivedConfigs();
  const staleCount = markPurchaseRunsStale({
    reason: `全局规则变更：${store.globalRules.rule_version}`,
  });
  appendAudit({
    entity_type: "global_rule",
    entity_id: store.globalRules.global_rule_id,
    action: "update",
    summary:
      staleCount > 0
        ? `更新全局规则版本 ${store.globalRules.rule_version}，标记 ${staleCount} 条采购建议待重生成`
        : `更新全局规则版本 ${store.globalRules.rule_version}`,
  });
  return store.globalRules;
}

export function listGenerationJobs(query: ListQuery): ListResult<GenerationJobEntity> {
  const store = getMemoryStore();
  syncGenerationJobSnapshotState();
  return filterSortAndPaginate(store.generationJobs, {
    query,
    searchFields: [
      "job_id",
      "job_name",
      "business_date",
      "status",
      "publication_status",
      "strategy_ids",
      "target_dealer_ids",
      "target_segment_ids",
    ],
    defaultSortBy: "business_date",
  });
}

export function getGenerationJobById(id: string) {
  const store = getMemoryStore();
  syncGenerationJobSnapshotState();
  return store.generationJobs.find((item) => item.job_id === id) ?? null;
}

export function createGenerationJob(input: GenerationJobUpsertInput) {
  const store = getMemoryStore();
  const exists = store.generationJobs.some((item) => item.job_id === input.job_id);
  if (exists) {
    conflict(`生成任务已存在: ${input.job_id}`);
  }
  ensureDealerExists(input.target_dealer_ids, "target_dealer_ids");
  ensureSegmentExists(input.target_segment_ids, "target_segment_ids");
  ensureStrategyExists(input.strategy_ids, "strategy_ids");
  const created: GenerationJobEntity = {
    ...input,
    publication_status: input.publication_status ?? "unpublished",
    last_precheck_at: input.last_precheck_at,
    last_sample_batch_id: input.last_sample_batch_id,
    last_batch_id: input.last_batch_id,
    published_batch_id: input.published_batch_id,
    published_at: input.published_at,
    ...nowPair(),
  };
  store.generationJobs.push(created);
  appendAudit({
    entity_type: "generation_job",
    entity_id: created.job_id,
    action: "create",
    summary: `新增生成任务 ${created.job_name}`,
  });
  return created;
}

export function updateGenerationJob(
  id: string,
  input: Partial<GenerationJobUpsertInput>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (input.target_dealer_ids) {
    ensureDealerExists(input.target_dealer_ids, "target_dealer_ids");
  }
  if (input.target_segment_ids) {
    ensureSegmentExists(input.target_segment_ids, "target_segment_ids");
  }
  if (input.strategy_ids) {
    ensureStrategyExists(input.strategy_ids, "strategy_ids");
  }
  if (
    input.publication_status &&
    !["unpublished", "ready", "published"].includes(input.publication_status)
  ) {
    validation({ publication_status: "publication_status 不合法" });
  }
  Object.assign(item, input, { updated_at: nowIso() });
  appendAudit({
    entity_type: "generation_job",
    entity_id: item.job_id,
    action: "update",
    summary: `更新生成任务 ${item.job_name}`,
  });
  return item;
}

export function cancelGenerationJob(id: string) {
  const store = getMemoryStore();
  const item = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (item.status === "cancelled") {
    conflict("生成任务已取消");
  }
  if (item.published_batch_id) {
    const publishedBatch = store.recommendationBatches.find(
      (batch) => batch.batch_id === item.published_batch_id,
    );
    if (publishedBatch) {
      publishedBatch.publication_status = "unpublished";
      publishedBatch.updated_at = nowIso();
    }
  }
  item.status = "cancelled";
  item.publication_status = "unpublished";
  item.updated_at = nowIso();
  appendAudit({
    entity_type: "generation_job",
    entity_id: item.job_id,
    action: "toggle",
    summary: `取消生成任务 ${item.job_name}`,
  });
  return item;
}

function buildJobPrecheckIssues(job: GenerationJobEntity): {
  targetDealerIds: string[];
  issues: string[];
} {
  const store = getMemoryStore();
  const issues: string[] = [];
  const targetDealerIds = resolveTargetDealerIds(job);

  if (targetDealerIds.length === 0) {
    issues.push("目标经销商为空");
  }

  const dealerMap = new Map(store.dealers.map((item) => [item.customer_id, item]));
  const missingDealers = targetDealerIds.filter((id) => !dealerMap.has(id));
  if (missingDealers.length > 0) {
    issues.push(`经销商不存在: ${missingDealers.join(", ")}`);
  }
  const inactiveDealers = targetDealerIds.filter(
    (id) => dealerMap.get(id)?.status === "inactive",
  );
  if (inactiveDealers.length > 0) {
    issues.push(`经销商已停用: ${inactiveDealers.join(", ")}`);
  }

  const strategyMap = new Map(
    store.recommendationStrategies.map((item) => [item.strategy_id, item]),
  );
  if (job.strategy_ids.length === 0) {
    issues.push("未配置策略");
  } else {
    const missingStrategies = job.strategy_ids.filter((id) => !strategyMap.has(id));
    if (missingStrategies.length > 0) {
      issues.push(`策略不存在: ${missingStrategies.join(", ")}`);
    }
    const inactiveStrategies = job.strategy_ids.filter(
      (id) => strategyMap.get(id)?.status === "inactive",
    );
    if (inactiveStrategies.length > 0) {
      issues.push(`策略已停用: ${inactiveStrategies.join(", ")}`);
    }
  }

  return { targetDealerIds, issues };
}

export function precheckGenerationJob(id: string): GenerationJobActionResult {
  const store = getMemoryStore();
  const job = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (job.status === "cancelled") {
    conflict("已取消任务不可预检");
  }

  const startedAt = nowIso();
  job.status = "prechecking";
  job.updated_at = startedAt;

  const { targetDealerIds, issues } = buildJobPrecheckIssues(job);
  const finishedAt = nowIso();
  job.last_precheck_at = finishedAt;
  if (issues.length > 0) {
    job.status = "failed";
    job.precheck_summary = `预检失败：${issues.join("；")}`;
    if (!job.published_batch_id) {
      job.publication_status = "unpublished";
    }
  } else {
    job.status = "ready";
    job.precheck_summary = `预检通过：覆盖 ${targetDealerIds.length} 个经销商，关联 ${job.strategy_ids.length} 条策略。`;
    if (job.publication_status !== "published") {
      job.publication_status = "unpublished";
    }
  }
  job.updated_at = finishedAt;

  appendAudit({
    entity_type: "generation_job",
    entity_id: job.job_id,
    action: "update",
    summary: `任务预检 ${job.job_name}：${issues.length > 0 ? "失败" : "通过"}`,
  });

  return {
    job,
    summary: job.precheck_summary,
    issues,
    sampled_customer_ids: targetDealerIds,
  };
}

async function executeGenerationBatch(input: {
  job: GenerationJobEntity;
  batchType: RecommendationBatchRecord["batch_type"];
  dealerIds: string[];
}): Promise<GenerationJobActionResult> {
  const { job, batchType, dealerIds } = input;
  if (dealerIds.length === 0) {
    validation({ target_dealer_ids: "目标经销商为空，无法执行生成" });
  }

  const hadPublished = Boolean(job.published_batch_id);
  const startedAt = nowIso();
  job.status = "running";
  job.updated_at = startedAt;

  const sampledCustomerIds: string[] = [];
  const generatedRunIds: string[] = [];
  const errors: string[] = [];
  let traceId: string | undefined;

  for (let i = 0; i < dealerIds.length; i += 1) {
    const dealerId = dealerIds[i];
    try {
      const result = await generateRecommendationsForCustomer({
        session_id: `session_admin_${job.job_id}_${i}_${Date.now()}`,
        customer_id: dealerId,
        trigger_source: "assistant",
        page_name: "/purchase",
      });
      sampledCustomerIds.push(dealerId);
      generatedRunIds.push(
        result.summary.hot_sale_run_id,
        result.summary.stockout_run_id,
        result.summary.campaign_run_id,
      );
      traceId = traceId ?? result.summary.trace_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`${dealerId}: ${message}`);
    }
  }

  const finishedAt = nowIso();
  const batchStatus: RecommendationBatchRecord["status"] =
    generatedRunIds.length === 0
      ? "failed"
      : errors.length > 0
        ? "partial_failed"
        : "success";
  const batchPublicationStatus: RecommendationBatchRecord["publication_status"] =
    batchStatus === "failed" ? "unpublished" : "ready";
  const batchSummary =
    batchStatus === "success"
      ? "生成完成"
      : batchStatus === "partial_failed"
        ? `部分失败（${errors.length} 个经销商）`
        : "生成失败";

  const batch = createRecommendationBatch({
    batch_id: createBatchId(
      batchType === "sample_generation" ? "batch_sample" : "batch_replay",
    ),
    batch_type: batchType,
    trigger_source: "admin",
    job_id: job.job_id,
    customer_id: dealerIds.length === 1 ? dealerIds[0] : undefined,
    trace_id: traceId,
    related_run_ids: generatedRunIds,
    config_snapshot_id: pickConfigSnapshotId(),
    started_at: startedAt,
    finished_at: finishedAt,
    status: batchStatus,
    publication_status: batchPublicationStatus,
    error_summary: errors.length > 0 ? errors.join(" | ") : undefined,
    fallback_used: false,
  });

  job.last_batch_id = batch.batch_id;
  if (batchType === "sample_generation") {
    job.last_sample_batch_id = batch.batch_id;
  }
  if (batchStatus === "failed") {
    job.status = "failed";
    if (!hadPublished) {
      job.publication_status = "unpublished";
    }
  } else {
    job.status = "completed";
    job.publication_status = hadPublished ? "published" : "ready";
  }
  job.precheck_summary =
    batchType === "sample_generation"
      ? `抽样试生成${batchSummary}，请确认后发布。`
      : `补跑${batchSummary}，如需生效请执行发布。`;
  job.updated_at = finishedAt;

  appendAudit({
    entity_type: "generation_job",
    entity_id: job.job_id,
    action: "update",
    summary: `任务 ${job.job_name} 执行${batchType === "sample_generation" ? "试生成" : "补跑"}：${batchSummary}`,
  });

  return {
    job,
    batch,
    summary: job.precheck_summary,
    issues: errors,
    sampled_customer_ids: sampledCustomerIds,
    generated_run_ids: generatedRunIds,
  };
}

export async function sampleGenerateGenerationJob(
  id: string,
): Promise<GenerationJobActionResult> {
  const store = getMemoryStore();
  const job = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (job.status === "cancelled") {
    conflict("已取消任务不可试生成");
  }
  if (!job.last_precheck_at) {
    conflict("请先执行预检");
  }
  const { targetDealerIds } = buildJobPrecheckIssues(job);
  const sampleDealerIds = targetDealerIds.slice(0, 1);
  if (sampleDealerIds.length === 0) {
    validation({ target_dealer_ids: "预检未覆盖可执行经销商" });
  }
  return executeGenerationBatch({
    job,
    batchType: "sample_generation",
    dealerIds: sampleDealerIds,
  });
}

export async function replayGenerationJob(id: string): Promise<GenerationJobActionResult> {
  const store = getMemoryStore();
  const job = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (job.status === "cancelled") {
    conflict("已取消任务不可补跑");
  }
  if (!job.last_precheck_at) {
    conflict("请先执行预检");
  }
  const { targetDealerIds } = buildJobPrecheckIssues(job);
  return executeGenerationBatch({
    job,
    batchType: "manual_replay",
    dealerIds: targetDealerIds,
  });
}

export async function replayRecommendationRecord(id: string) {
  const store = getMemoryStore();
  const run = findById(
    store.recommendationRuns,
    (record) => record.recommendation_run_id === id,
    "推荐记录不存在",
  );
  if (!run.customer_id) {
    conflict("当前记录缺少经销商信息，无法补跑");
  }

  const sourceBatch = run.batch_id
    ? store.recommendationBatches.find((record) => record.batch_id === run.batch_id)
    : undefined;
  const startedAt = nowIso();
  const replaySessionId = `session_admin_record_${run.recommendation_run_id}_${Date.now()}`;
  let generatedRunIds: string[] = [];
  let traceId = "";
  let summary = "";
  let createdBatch: RecommendationBatchRecord | undefined;

  const isPurchaseScene =
    run.scene === "hot_sale_restock" ||
    run.scene === "stockout_restock" ||
    run.scene === "campaign_stockup" ||
    run.scene === "daily_recommendation" ||
    run.scene === "weekly_focus";

  if (isPurchaseScene) {
    const replayScene: Parameters<typeof generateRecommendationSceneForCustomer>[0]["scene"] =
      run.scene === "hot_sale_restock" ||
      run.scene === "stockout_restock" ||
      run.scene === "campaign_stockup"
        ? run.scene
        : run.scene === "weekly_focus"
          ? "campaign_stockup"
          : "stockout_restock";
    const result = await generateRecommendationSceneForCustomer({
      session_id: replaySessionId,
      customer_id: run.customer_id,
      scene: replayScene,
      trigger_source: "assistant",
      page_name: "/purchase",
    });
    generatedRunIds = [result.summary.run_id];
    traceId = result.summary.trace_id ?? "";
    const sceneLabel =
      replayScene === "campaign_stockup"
        ? "活动备货建议"
        : replayScene === "hot_sale_restock"
          ? "热销补货建议"
          : "缺货补货建议";
    summary = `已重新生成 ${run.customer_name} 的${sceneLabel}`;
    const finishedAt = nowIso();
    createdBatch = createRecommendationBatch({
      batch_id: createBatchId("batch_replay"),
      batch_type: "manual_replay",
      trigger_source: "admin",
      session_id: replaySessionId,
      job_id: sourceBatch?.job_id,
      customer_id: run.customer_id,
      scene: replayScene,
      trace_id: traceId || undefined,
      related_run_ids: generatedRunIds,
      config_snapshot_id: pickConfigSnapshotId(),
      started_at: startedAt,
      finished_at: finishedAt,
      status: "success",
      publication_status: "ready",
      fallback_used: false,
    });

    appendAudit({
      entity_type: "recommendation_batch",
      entity_id: createdBatch.batch_id,
      action: "create",
      summary: `补跑单条建议：${run.customer_name} · ${run.scene}`,
    });
  } else if (
    run.scene === "checkout_optimization" ||
    run.scene === "box_pair_optimization" ||
    run.scene === "threshold_topup"
  ) {
    const sourceSession = getCartBySession(run.session_id);
    if (sourceSession.items.length === 0) {
      conflict("当前凑单记录缺少购物车商品，无法补跑");
    }
    const result = await generateCartOptimizationForSession({
      session_id: replaySessionId,
      customer_id: run.customer_id,
      cart_items: sourceSession.items.map((item) => ({
        sku_id: item.sku_id,
        qty: item.qty,
      })),
    });
    generatedRunIds = [result.summary.recommendation_run_id];
    traceId = result.summary.trace_id ?? "";
    summary = `已重新生成 ${run.customer_name} 的结算页实时凑单建议（未创建采购批次）`;
  } else {
    conflict("当前场景暂不支持单条补跑");
  }

  return {
    batch: createdBatch,
    generated_run_ids: generatedRunIds,
    trace_id: traceId || undefined,
    summary,
  };
}

export function publishGenerationJob(id: string): GenerationJobActionResult {
  const store = getMemoryStore();
  const job = findById(
    store.generationJobs,
    (record) => record.job_id === id,
    "生成任务不存在",
  );
  if (job.status === "cancelled") {
    conflict("已取消任务不可发布");
  }

  const candidateBatchIds = Array.from(
    new Set(
      [job.last_batch_id, job.last_sample_batch_id].filter(
        (batchId): batchId is string => Boolean(batchId),
      ),
    ),
  );
  if (candidateBatchIds.length === 0) {
    conflict("暂无可发布批次，请先执行试生成或补跑");
  }

  const batchCandidates = candidateBatchIds
    .map((batchId) =>
      store.recommendationBatches.find((record) => record.batch_id === batchId),
    )
    .filter((record): record is RecommendationBatchRecord => Boolean(record))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  if (batchCandidates.length === 0) {
    conflict("建议单批次不存在");
  }
  const batch = batchCandidates[0];

  if (!["success", "partial_failed"].includes(batch.status)) {
    conflict("仅成功或部分成功的批次可发布");
  }
  if (batch.related_run_ids.length === 0) {
    conflict("批次没有有效建议记录，无法发布");
  }

  const timestamp = nowIso();
  for (const record of store.recommendationBatches) {
    if (record.job_id === job.job_id && record.batch_id !== batch.batch_id) {
      if (record.publication_status === "published") {
        record.publication_status = "unpublished";
        record.updated_at = timestamp;
      }
    }
  }

  batch.job_id = job.job_id;
  batch.publication_status = "published";
  batch.updated_at = timestamp;

  job.publication_status = "published";
  job.published_batch_id = batch.batch_id;
  job.published_at = timestamp;
  job.status = "completed";
  job.precheck_summary = `发布完成：已发布批次 ${batch.batch_id}`;
  job.updated_at = timestamp;

  appendAudit({
    entity_type: "generation_job",
    entity_id: job.job_id,
    action: "apply",
    summary: `发布生成任务 ${job.job_name}`,
  });

  return {
    job,
    batch,
    summary: `任务 ${job.job_name} 发布成功`,
    sampled_customer_ids: resolveTargetDealerIds(job),
    generated_run_ids: batch.related_run_ids,
  };
}

const OPEN_RECOMMENDATION_STATUSES = new Set<RecommendationItemRecord["final_status"]>([
  "pending",
  "viewed",
  "explained",
]);

const BUNDLE_TEMPLATE_DEFINITIONS: Array<
  Pick<
    BundleTemplate,
    "template_id" | "template_type" | "template_name" | "template_subtitle"
  >
> = [
  {
    template_id: "bundle_hot_sale",
    template_type: "hot_sale_restock",
    template_name: "热销补货",
    template_subtitle: "优先补齐高动销 SKU，保障本周周转。",
  },
  {
    template_id: "bundle_stockout",
    template_type: "stockout_restock",
    template_name: "缺货补货",
    template_subtitle: "补齐临近缺货品，优先覆盖常购基础货。",
  },
  {
    template_id: "bundle_campaign",
    template_type: "campaign_stockup",
    template_name: "活动备货",
    template_subtitle: "按当前活动与周推商品完成备货。",
  },
];

function sumBundleAmount(items: BundleTemplateItem[]) {
  return items.reduce((sum, item) => sum + item.line_amount, 0);
}

function asBundleTemplateItem(
  record: RecommendationItemRecord,
  product: ProductEntity,
): BundleTemplateItem {
  const suggestedQty = Math.max(1, record.suggested_qty);
  return {
    recommendation_item_id: record.recommendation_item_id,
    sku_id: record.sku_id,
    sku_name: record.sku_name,
    suggested_qty: suggestedQty,
    reason: record.reason,
    reason_tags: record.reason_tags,
    priority: record.suggested_rank,
    action_type: record.action_type,
    unit_price: product.price_per_case,
    line_amount: product.price_per_case * suggestedQty,
  };
}

function dedupeBundleItems(items: BundleTemplateItem[]) {
  const map = new Map<string, BundleTemplateItem>();
  for (const item of items) {
    const existing = map.get(item.sku_id);
    if (!existing || item.priority < existing.priority) {
      map.set(item.sku_id, item);
    }
  }
  return Array.from(map.values()).sort((left, right) => left.priority - right.priority);
}

function pickOpenItemsForRun(
  run: RecommendationRunRecord | undefined,
  items: RecommendationItemRecord[],
) {
  if (!run) {
    return [] as RecommendationItemRecord[];
  }
  return items
    .filter(
      (item) =>
        item.recommendation_run_id === run.recommendation_run_id &&
        OPEN_RECOMMENDATION_STATUSES.has(item.final_status),
    )
    .sort((left, right) => left.suggested_rank - right.suggested_rank);
}

function createBundleTemplate(input: {
  templateType: BundleTemplate["template_type"];
  recommendationItems: BundleTemplateItem[];
}): BundleTemplate {
  const definition = BUNDLE_TEMPLATE_DEFINITIONS.find(
    (item) => item.template_type === input.templateType,
  );
  if (!definition) {
    throw new Error(`unknown template type: ${input.templateType}`);
  }

  const recommended = dedupeBundleItems(input.recommendationItems).slice(0, 5);

  return {
    ...definition,
    source: "published_recommendation",
    estimated_amount: sumBundleAmount(recommended),
    items: recommended,
  };
}

function toCartSummary(input: {
  source: PublishedSuggestionsCartSummary["source"];
  skuCount: number;
  itemCount: number;
  totalAmount: number;
  thresholdAmount: number;
}): PublishedSuggestionsCartSummary {
  const safeTotal = Math.max(0, Math.round(input.totalAmount));
  const safeThreshold = Math.max(0, Math.round(input.thresholdAmount));
  const gap = Math.max(0, safeThreshold - safeTotal);
  return {
    source: input.source,
    sku_count: Math.max(0, input.skuCount),
    item_count: Math.max(0, input.itemCount),
    total_amount: safeTotal,
    threshold_amount: safeThreshold,
    gap_to_threshold: gap,
    threshold_reached: gap === 0,
  };
}

function projectCartSummaryFromTemplates(
  templates: BundleTemplate[],
  thresholdAmount: number,
): PublishedSuggestionsCartSummary {
  const projection = new Map<string, BundleTemplateItem>();
  for (const template of templates) {
    for (const item of template.items) {
      const existing = projection.get(item.sku_id);
      if (!existing || item.suggested_qty > existing.suggested_qty) {
        projection.set(item.sku_id, item);
      }
    }
  }
  const projectedItems = Array.from(projection.values());
  return toCartSummary({
    source: "template_projection",
    skuCount: projectedItems.length,
    itemCount: projectedItems.reduce((sum, item) => sum + item.suggested_qty, 0),
    totalAmount: projectedItems.reduce((sum, item) => sum + item.line_amount, 0),
    thresholdAmount,
  });
}

function resolveActivityHighlights(input: {
  campaigns: CampaignEntity[];
  productMap: Map<string, ProductEntity>;
  weeklyRunItems: RecommendationItemRecord[];
}): ActivityHighlight[] {
  const scopedCampaigns = input.campaigns.slice(0, 3);

  const weeklyItemMap = new Map<string, RecommendationItemRecord>();
  for (const item of input.weeklyRunItems) {
    const existing = weeklyItemMap.get(item.sku_id);
    if (!existing || item.suggested_rank < existing.suggested_rank) {
      weeklyItemMap.set(item.sku_id, item);
    }
  }

  return scopedCampaigns.map((campaign) => {
    const items = campaign.weekly_focus_items
      .map((skuId) => {
        const product = input.productMap.get(skuId);
        if (!product || product.status !== "active") {
          return null;
        }
        const weekly = weeklyItemMap.get(skuId);
        return weekly ? asBundleTemplateItem(weekly, product) : null;
      })
      .filter((item): item is BundleTemplateItem => Boolean(item))
      .slice(0, 5);

    return {
      activity_id: campaign.campaign_id,
      activity_name: campaign.campaign_name,
      week_id: campaign.week_id,
      promo_type: campaign.promo_type,
      promo_threshold: campaign.promo_threshold,
      activity_notes: campaign.activity_notes,
      sku_ids: items.map((item) => item.sku_id),
      estimated_amount: sumBundleAmount(items),
      items,
    };
  }).filter((item) => item.items.length > 0);
}

function pickLatestRunByScene(input: {
  runIds: string[];
  customerId: string;
  scene: SuggestionScene;
}): RecommendationRunRecord | undefined {
  const store = getMemoryStore();
  return input.runIds
    .map((runId) =>
      store.recommendationRuns.find(
        (record) =>
          record.recommendation_run_id === runId &&
          record.customer_id === input.customerId &&
          record.scene === input.scene,
      ),
    )
    .filter((record): record is RecommendationRunRecord => Boolean(record))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
}

export function getPublishedSuggestionsForCustomer(
  customerId: string,
): PublishedSuggestionsPayload {
  const store = getMemoryStore();
  const dealer =
    store.dealers.find((item) => item.customer_id === customerId && item.status === "active") ??
    null;
  const productMap = new Map(
    store.products
      .filter((item) => item.status === "active")
      .map((item) => [item.sku_id, item]),
  );

  const publishedJobs = [...store.generationJobs]
    .filter(
      (item) =>
        item.publication_status === "published" &&
        item.published_batch_id &&
        resolveTargetDealerIds(item).includes(customerId),
    )
    .sort((left, right) =>
      (right.published_at ?? right.updated_at).localeCompare(
        left.published_at ?? left.updated_at,
      ),
    );

  let selectedJob: GenerationJobEntity | undefined;
  let selectedBatch: RecommendationBatchRecord | undefined;

  for (const job of publishedJobs) {
    const batch = store.recommendationBatches.find(
      (record) =>
        record.batch_id === job.published_batch_id &&
        record.publication_status === "published",
    );
    if (!batch) {
      continue;
    }
    const hasCustomerRuns = batch.related_run_ids.some((runId) => {
      const run = store.recommendationRuns.find(
        (record) => record.recommendation_run_id === runId,
      );
      return (
        run?.customer_id === customerId &&
        (run.scene === "hot_sale_restock" ||
          run.scene === "stockout_restock" ||
          run.scene === "campaign_stockup")
      );
    });
    if (!hasCustomerRuns) {
      continue;
    }
    selectedJob = job;
    selectedBatch = batch;
    break;
  }

  if (!selectedBatch) {
    selectedJob = undefined;
  }

  const runIds = selectedBatch?.related_run_ids ?? [];
  const hotSaleRun = pickLatestRunByScene({
    runIds,
    customerId,
    scene: "hot_sale_restock",
  });
  const stockoutRun = pickLatestRunByScene({
    runIds,
    customerId,
    scene: "stockout_restock",
  });
  const campaignRun = pickLatestRunByScene({
    runIds,
    customerId,
    scene: "campaign_stockup",
  });

  const hotSaleOpenItems = pickOpenItemsForRun(
    hotSaleRun,
    store.recommendationItems,
  );
  const stockoutOpenItems = pickOpenItemsForRun(
    stockoutRun,
    store.recommendationItems,
  );
  const campaignOpenItems = pickOpenItemsForRun(
    campaignRun,
    store.recommendationItems,
  );

  const hotSaleRecommendationItems = hotSaleOpenItems
    .map((item) => {
      const product = productMap.get(item.sku_id);
      return product ? asBundleTemplateItem(item, product) : null;
    })
    .filter((item): item is BundleTemplateItem => Boolean(item));

  const stockoutRecommendationItems = stockoutOpenItems
    .map((item) => {
      const product = productMap.get(item.sku_id);
      return product ? asBundleTemplateItem(item, product) : null;
    })
    .filter((item): item is BundleTemplateItem => Boolean(item));

  const campaignRecommendationItems = campaignOpenItems
    .map((item) => {
      const product = productMap.get(item.sku_id);
      return product ? asBundleTemplateItem(item, product) : null;
    })
    .filter((item): item is BundleTemplateItem => Boolean(item));
  const matchedCampaigns = dealer
    ? matchCampaignsForDealer({
        campaigns: store.campaigns,
        dealer,
        dealerSegments: store.dealerSegments,
        products: store.products,
      })
    : [];
  const orderedCampaigns = matchedCampaigns.map((item) => item.campaign);
  if (campaignRun?.campaign_id) {
    const runCampaignIndex = orderedCampaigns.findIndex(
      (item) => item.campaign_id === campaignRun.campaign_id,
    );
    if (runCampaignIndex > 0) {
      const [runCampaign] = orderedCampaigns.splice(runCampaignIndex, 1);
      orderedCampaigns.unshift(runCampaign);
    }
  }

  const activityHighlights = resolveActivityHighlights({
    campaigns: orderedCampaigns,
    productMap,
    weeklyRunItems: campaignOpenItems,
  });

  const bundleTemplates: BundleTemplate[] = [
    createBundleTemplate({
      templateType: "hot_sale_restock",
      recommendationItems: hotSaleRecommendationItems,
    }),
    createBundleTemplate({
      templateType: "stockout_restock",
      recommendationItems: stockoutRecommendationItems,
    }),
    createBundleTemplate({
      templateType: "campaign_stockup",
      recommendationItems: campaignRecommendationItems,
    }),
  ];

  const customerSessions = Object.values(store.cartSessions)
    .filter((session) => session.customer_id === customerId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

  const cartSummary = customerSessions[0]
    ? toCartSummary({
        source: "customer_cart",
        skuCount: customerSessions[0].summary.sku_count,
        itemCount: customerSessions[0].summary.item_count,
        totalAmount: customerSessions[0].summary.total_amount,
        thresholdAmount: customerSessions[0].summary.threshold_amount,
      })
    : projectCartSummaryFromTemplates(bundleTemplates, store.rules.threshold_amount);

  return {
    bundleTemplates,
    activityHighlights,
    cartSummary,
    summary: {
      published: Boolean(selectedBatch),
      job_id: selectedJob?.job_id,
      batch_id: selectedBatch?.batch_id,
      published_at:
        selectedJob?.published_at ??
        selectedBatch?.finished_at ??
        selectedBatch?.updated_at,
      trace_id:
        hotSaleRun?.trace_id ??
        stockoutRun?.trace_id ??
        campaignRun?.trace_id ??
        selectedBatch?.trace_id,
    },
  } as PublishedSuggestionsPayload;
}

export function listRecommendationBatches(
  query: ListQuery,
  filters?: RecommendationBatchFilters,
): ListResult<RecommendationBatchRecord> {
  const store = getMemoryStore();
  const checkoutScenes = new Set<SuggestionScene>([
    "checkout_optimization",
    "box_pair_optimization",
    "threshold_topup",
  ]);
  const runById = new Map(
    store.recommendationRuns.map((run) => [run.recommendation_run_id, run]),
  );
  let records = [...store.recommendationBatches].filter((batch) => {
    const relatedRuns = batch.related_run_ids
      .map((runId) => runById.get(runId))
      .filter((run): run is RecommendationRunRecord => Boolean(run));
    if (relatedRuns.length === 0) {
      return batch.scene ? !checkoutScenes.has(batch.scene) : true;
    }
    return relatedRuns.every(
      (run) =>
        !checkoutScenes.has(run.scene) &&
        run.surface !== "checkout" &&
        run.generation_mode !== "realtime",
    );
  });
  if (filters?.dateFrom) {
    records = records.filter((item) => item.created_at >= filters.dateFrom!);
  }
  if (filters?.dateTo) {
    records = records.filter((item) => item.created_at <= filters.dateTo!);
  }
  if (filters?.jobId) {
    records = records.filter((item) => item.job_id === filters.jobId);
  }
  if (filters?.customerId) {
    records = records.filter((item) => item.customer_id === filters.customerId);
  }
  if (filters?.scene) {
    records = records.filter((item) => item.scene === filters.scene);
  }
  if (filters?.status) {
    records = records.filter((item) => item.status === filters.status);
  }
  if (filters?.publicationStatus) {
    records = records.filter(
      (item) => item.publication_status === filters.publicationStatus,
    );
  }
  if (filters?.triggerSource) {
    records = records.filter((item) => item.trigger_source === filters.triggerSource);
  }
  if (filters?.batchType) {
    records = records.filter((item) => item.batch_type === filters.batchType);
  }

  return filterSortAndPaginate(records, {
    query,
    searchFields: [
      "batch_id",
      "batch_type",
      "trigger_source",
      "customer_id",
      "scene",
      "status",
      "related_run_ids",
    ],
    defaultSortBy: "created_at",
  });
}

export function getRecommendationBatchById(id: string) {
  const store = getMemoryStore();
  return store.recommendationBatches.find((item) => item.batch_id === id) ?? null;
}

export function createRecommendationBatch(input: RecommendationBatchUpsertInput) {
  const store = getMemoryStore();
  const exists = store.recommendationBatches.some((item) => item.batch_id === input.batch_id);
  if (exists) {
    conflict(`建议单批次已存在: ${input.batch_id}`);
  }
  if (input.job_id) {
    const hasJob = store.generationJobs.some((item) => item.job_id === input.job_id);
    if (!hasJob) {
      validation({ job_id: `任务不存在: ${input.job_id}` });
    }
  }
  const runSet = new Set(store.recommendationRuns.map((item) => item.recommendation_run_id));
  const missingRuns = input.related_run_ids.filter((id) => !runSet.has(id));
  if (missingRuns.length > 0) {
    validation({
      related_run_ids: `以下 run 不存在: ${missingRuns.join(", ")}`,
    });
  }
  const created: RecommendationBatchRecord = {
    ...input,
    publication_status: input.publication_status ?? "unpublished",
    ...nowPair(),
  };
  store.recommendationBatches.push(created);
  const relatedRunIds = new Set(created.related_run_ids);
  for (const run of store.recommendationRuns) {
    if (!relatedRunIds.has(run.recommendation_run_id)) {
      continue;
    }
    run.batch_id = created.batch_id;
    run.updated_at = created.updated_at;
  }
  appendAudit({
    entity_type: "recommendation_batch",
    entity_id: created.batch_id,
    action: "create",
    summary: `新增建议单批次 ${created.batch_id}`,
  });
  return created;
}

export function updateRecommendationBatch(
  id: string,
  input: Partial<RecommendationBatchUpsertInput>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.recommendationBatches,
    (record) => record.batch_id === id,
    "建议单批次不存在",
  );
  if (input.related_run_ids) {
    const runSet = new Set(
      store.recommendationRuns.map((record) => record.recommendation_run_id),
    );
    const missingRuns = input.related_run_ids.filter((runId) => !runSet.has(runId));
    if (missingRuns.length > 0) {
      validation({
        related_run_ids: `以下 run 不存在: ${missingRuns.join(", ")}`,
      });
    }
  }
  if (input.job_id) {
    const hasJob = store.generationJobs.some((record) => record.job_id === input.job_id);
    if (!hasJob) {
      validation({ job_id: `任务不存在: ${input.job_id}` });
    }
  }
  if (
    input.publication_status &&
    !["unpublished", "ready", "published"].includes(input.publication_status)
  ) {
    validation({ publication_status: "publication_status 不合法" });
  }
  const previousRunIds = new Set(item.related_run_ids);
  Object.assign(item, input, { updated_at: nowIso() });
  const nextRunIds = new Set(item.related_run_ids);
  for (const run of store.recommendationRuns) {
    const wasLinked = previousRunIds.has(run.recommendation_run_id);
    const isLinked = nextRunIds.has(run.recommendation_run_id);
    if (!wasLinked && !isLinked) {
      continue;
    }
    if (isLinked) {
      run.batch_id = item.batch_id;
      run.updated_at = item.updated_at;
      continue;
    }
    if (wasLinked && run.batch_id === item.batch_id) {
      run.batch_id = undefined;
      run.updated_at = item.updated_at;
    }
  }
  appendAudit({
    entity_type: "recommendation_batch",
    entity_id: item.batch_id,
    action: "update",
    summary: `更新建议单批次 ${item.batch_id}`,
  });
  return item;
}

export function listRecommendationRuns(
  query: ListQuery,
  filters: RecommendationRecordFilters = {},
): ListResult<RecommendationRunRecord> {
  const store = getMemoryStore();
  let records = [...store.recommendationRuns];
  const purchaseScenes = new Set<SuggestionScene>([
    "hot_sale_restock",
    "stockout_restock",
    "campaign_stockup",
    "daily_recommendation",
    "weekly_focus",
  ]);
  const checkoutScenes = new Set<SuggestionScene>([
    "checkout_optimization",
    "box_pair_optimization",
    "threshold_topup",
  ]);

  if (filters.dateFrom) {
    records = records.filter((item) => item.created_at >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    records = records.filter((item) => item.created_at <= filters.dateTo!);
  }
  if (filters.customerId) {
    records = records.filter((item) => item.customer_id === filters.customerId);
  }
  if (filters.surface) {
    records = records.filter((item) => item.surface === filters.surface);
  }
  if (filters.generationMode) {
    records = records.filter(
      (item) => item.generation_mode === filters.generationMode,
    );
  }
  if (filters.scene) {
    records = records.filter((item) => {
      if (filters.scene === "purchase_bundle") {
        return (
          purchaseScenes.has(item.scene) &&
          item.surface === "purchase" &&
          item.generation_mode === "precomputed"
        );
      }
      if (filters.scene === "checkout_optimization") {
        return (
          checkoutScenes.has(item.scene) &&
          item.surface === "checkout" &&
          item.generation_mode === "realtime"
        );
      }
      if (filters.scene === "daily_recommendation") {
        return (
          item.scene === "hot_sale_restock" ||
          item.scene === "stockout_restock" ||
          item.scene === "daily_recommendation"
        );
      }
      if (filters.scene === "weekly_focus") {
        return item.scene === "campaign_stockup" || item.scene === "weekly_focus";
      }
      if (filters.scene === "box_pair_optimization" || filters.scene === "threshold_topup") {
        return checkoutScenes.has(item.scene);
      }
      return item.scene === filters.scene;
    });
  }
  if (filters.modelName) {
    const keyword = filters.modelName.toLowerCase();
    records = records.filter((item) => item.model_name.toLowerCase().includes(keyword));
  }
  if (filters.batchId) {
    records = records.filter((item) => item.batch_id === filters.batchId);
  }
  if (filters.strategyId) {
    records = records.filter((item) => item.strategy_id === filters.strategyId);
  }
  if (filters.expressionTemplateId) {
    records = records.filter(
      (item) => item.expression_template_id === filters.expressionTemplateId,
    );
  }
  if (filters.skuId) {
    const runIdSet = new Set(
      store.recommendationItems
        .filter((item) => item.sku_id === filters.skuId)
        .map((item) => item.recommendation_run_id),
    );
    records = records.filter(
      (item) =>
        runIdSet.has(item.recommendation_run_id) ||
        item.returned_sku_ids.includes(filters.skuId!),
    );
  }

  if (filters.adoptionStatus === "adopted") {
    records = records.filter((item) =>
      ["partially_applied", "fully_applied"].includes(item.status),
    );
  } else if (filters.adoptionStatus === "not_adopted") {
    records = records.filter((item) => ["generated", "ignored"].includes(item.status));
  }

  return filterSortAndPaginate(records, {
    query,
    searchFields: [
      "recommendation_run_id",
      "customer_id",
      "customer_name",
      "scene",
      "status",
      "model_name",
      "returned_sku_ids",
      "candidate_sku_ids",
    ],
    statusField: "status",
    defaultSortBy: "created_at",
  });
}

export function listRecommendationRecords(
  query: ListQuery,
  filters: RecommendationRecordFilters = {},
): ListResult<RecommendationRunRecord> {
  return listRecommendationRuns(query, filters);
}

export function getRecommendationRunDetail(id: string) {
  const store = getMemoryStore();
  const run = store.recommendationRuns.find((item) => item.recommendation_run_id === id);
  if (!run) {
    return null;
  }
  const items = store.recommendationItems
    .filter((item) => item.recommendation_run_id === id)
    .sort((left, right) => left.suggested_rank - right.suggested_rank);
  return { run, items };
}

export function getRecommendationRecordDetail(id: string) {
  return getRecommendationRunDetail(id);
}

export function listRecoverySnapshots(query: ListQuery): ListResult<RecoverySnapshotRecord> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.recoverySnapshots, {
    query,
    searchFields: [
      "snapshot_id",
      "snapshot_name",
      "source",
      "description",
      "config_snapshot_id",
      "related_entity_types",
      "status",
      "created_by",
    ],
    defaultSortBy: "created_at",
  });
}

export function getRecoverySnapshotById(id: string) {
  const store = getMemoryStore();
  return store.recoverySnapshots.find((item) => item.snapshot_id === id) ?? null;
}

export function createRecoverySnapshot(input: UpsertInput<RecoverySnapshotRecord>) {
  const store = getMemoryStore();
  const exists = store.recoverySnapshots.some((item) => item.snapshot_id === input.snapshot_id);
  if (exists) {
    conflict(`恢复快照已存在: ${input.snapshot_id}`);
  }
  const created: RecoverySnapshotRecord = { ...input, ...nowPair() };
  store.recoverySnapshots.push(created);
  appendAudit({
    entity_type: "recovery_snapshot",
    entity_id: created.snapshot_id,
    action: "create",
    summary: `新增恢复快照 ${created.snapshot_name}`,
  });
  return created;
}

export function updateRecoverySnapshot(
  id: string,
  input: Partial<UpsertInput<RecoverySnapshotRecord>>,
) {
  const store = getMemoryStore();
  const item = findById(
    store.recoverySnapshots,
    (record) => record.snapshot_id === id,
    "恢复快照不存在",
  );
  Object.assign(item, input, { updated_at: nowIso() });
  appendAudit({
    entity_type: "recovery_snapshot",
    entity_id: item.snapshot_id,
    action: "update",
    summary: `更新恢复快照 ${item.snapshot_name}`,
  });
  return item;
}

export function archiveRecoverySnapshot(id: string) {
  const item = findById(
    getMemoryStore().recoverySnapshots,
    (record) => record.snapshot_id === id,
    "恢复快照不存在",
  );
  if (item.status === "archived") {
    conflict("恢复快照已归档");
  }
  item.status = "archived";
  item.updated_at = nowIso();
  appendAudit({
    entity_type: "recovery_snapshot",
    entity_id: item.snapshot_id,
    action: "delete",
    summary: `归档恢复快照 ${item.snapshot_name}`,
  });
  return item;
}

export function applyRecoverySnapshot(id: string) {
  const store = getMemoryStore();
  const item = findById(
    store.recoverySnapshots,
    (record) => record.snapshot_id === id,
    "恢复快照不存在",
  );
  item.status = "applied";
  item.applied_at = nowIso();
  item.updated_at = nowIso();
  appendAudit({
    entity_type: "recovery_snapshot",
    entity_id: item.snapshot_id,
    action: "apply",
    summary: `应用恢复快照 ${item.snapshot_name}`,
  });
  return item;
}

export function resetDemoData() {
  const store = resetMemoryStoreToSeed();
  const snapshot =
    store.recoverySnapshots.find((item) => item.snapshot_id === "snapshot_seed_default") ??
    store.recoverySnapshots[0] ??
    null;
  const appliedAt = nowIso();

  if (snapshot) {
    snapshot.status = "applied";
    snapshot.applied_at = appliedAt;
    snapshot.updated_at = appliedAt;
  }

  appendAuditLog({
    entity_type: "recovery_snapshot",
    entity_id: snapshot?.snapshot_id ?? "snapshot_seed_default",
    action: "apply",
    summary: "恢复演示基线数据",
  });

  return {
    snapshot,
    summary: "已恢复到演示初始数据，运行期改动已清空。",
  };
}

export function getReportSummary() {
  refreshDerivedConfigs();
  const store = getMemoryStore();
  const countActive = <T extends { status?: string }>(items: T[]) =>
    items.filter((item) => item.status === "active").length;

  return {
    entities: {
      products: {
        total: store.products.length,
        active: countActive(store.products),
      },
      dealers: {
        total: store.dealers.length,
        active: countActive(store.dealers),
      },
      recommendationStrategies: {
        total: store.recommendationStrategies.length,
        active: countActive(store.recommendationStrategies),
      },
      expressionTemplates: {
        total: store.expressionTemplates.length,
        active: countActive(store.expressionTemplates),
      },
      campaigns: {
        total: store.campaigns.length,
        active: countActive(store.campaigns),
      },
    },
    metrics: store.metrics,
    recommendationRuns: {
      total: store.recommendationRuns.length,
      generated: store.recommendationRuns.filter((item) => item.status === "generated").length,
      partiallyApplied: store.recommendationRuns.filter(
        (item) => item.status === "partially_applied",
      ).length,
      fullyApplied: store.recommendationRuns.filter(
        (item) => item.status === "fully_applied",
      ).length,
      ignored: store.recommendationRuns.filter((item) => item.status === "ignored").length,
    },
  };
}

export function listReportEvents(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.metrics.latestEvents, {
    query,
    searchFields: ["customerId", "customerName", "eventType", "scene"],
    defaultSortBy: "timestamp",
  });
}

export function listAuditLogs(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.auditLogs, {
    query,
    searchFields: ["entity_type", "entity_id", "action", "summary"],
    defaultSortBy: "timestamp",
  });
}

export function inferSceneFromActionType(
  actionType: TemplateReferenceItem["sort_order"] | number,
): SuggestionScene {
  if (actionType > 2) {
    return "checkout_optimization";
  }
  return "hot_sale_restock";
}
