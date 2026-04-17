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
import { generateRecommendationsForCustomer } from "@/lib/domain/business-service";
import {
  appendAuditLog,
  getMemoryStore,
  nowIso,
} from "@/lib/memory/store";
import type {
  CampaignEntity,
  DealerEntity,
  DealerSegmentEntity,
  DealerSuggestionTemplateEntity,
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

type PublishedSuggestionItem = {
  recommendation_item_id: string;
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  reason: string;
  reason_tags: string[];
  priority: number;
  action_type: "add_to_cart" | "adjust_qty" | "replace_item";
};

export type PublishedSuggestionsPayload = {
  dailyRecommendations: PublishedSuggestionItem[];
  weeklyFocusRecommendations: PublishedSuggestionItem[];
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

  const recommendation = pick("recommendation");
  const cart = pick("cart_optimization");
  const explain = pick("explanation");
  const shared = recommendation ?? cart ?? explain;

  return {
    global_style: {
      tone: shared?.tone ?? "专业、简洁、面向执行",
      avoid: shared?.avoid ?? [],
      reason_limit: shared?.reason_limit ?? 3,
    },
    recommendation_prompt: {
      system_role: recommendation?.system_role ?? "",
      instruction: recommendation?.instruction ?? "",
    },
    cart_opt_prompt: {
      system_role: cart?.system_role ?? "",
      instruction: cart?.instruction ?? "",
    },
    explain_prompt: {
      system_role: explain?.system_role ?? "",
      instruction: explain?.instruction ?? "",
    },
  };
}

function strategyToLegacyTemplate(
  strategy: RecommendationStrategyEntity,
  expressionTemplates: ExpressionTemplateEntity[],
): DealerSuggestionTemplateEntity {
  const expression = expressionTemplates.find(
    (item) => item.expression_template_id === strategy.expression_template_id,
  );
  return {
    template_id: strategy.strategy_id,
    customer_id: strategy.target_dealer_ids[0] ?? "",
    template_name: strategy.strategy_name,
    scene: strategy.scene,
    reference_items: strategy.reference_items,
    business_notes: strategy.business_notes,
    style_hint: expression?.style_hint ?? "沿用表达模板",
    priority: strategy.priority,
    enabled: strategy.status === "active",
    created_at: strategy.created_at,
    updated_at: strategy.updated_at,
  };
}

function legacyTemplateToStrategy(
  input: UpsertInput<DealerSuggestionTemplateEntity>,
): UpsertInput<RecommendationStrategyEntity> {
  return {
    strategy_id: input.template_id,
    strategy_name: input.template_name,
    scene: input.scene,
    target_dealer_ids: [input.customer_id],
    dealer_segment_ids: [],
    product_pool_ids: ["pool_regular_replenishment", "pool_pairing"],
    campaign_ids: [],
    candidate_sku_ids: input.reference_items.map((item) => item.sku_id),
    reference_items: input.reference_items,
    business_notes: input.business_notes,
    expression_template_id: "expr_recommendation_default",
    priority: input.priority,
    status: input.enabled ? "active" : "inactive",
  };
}

function syncLegacyAdapters() {
  const store = getMemoryStore();
  store.suggestionTemplates = store.recommendationStrategies.map((item) =>
    strategyToLegacyTemplate(item, store.expressionTemplates),
  );
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

function upsertExpressionTemplateByType(
  type: ExpressionTemplateEntity["template_type"],
  payload: {
    name: string;
    system_role: string;
    instruction: string;
    tone: string;
    avoid: string[];
    reason_limit: number;
  },
) {
  const store = getMemoryStore();
  const existing = store.expressionTemplates.find((item) => item.template_type === type);
  const timestamp = nowIso();
  if (existing) {
    existing.expression_template_name = payload.name;
    existing.system_role = payload.system_role;
    existing.instruction = payload.instruction;
    existing.tone = payload.tone;
    existing.avoid = payload.avoid;
    existing.reason_limit = payload.reason_limit;
    existing.scene = "all";
    existing.status = "active";
    existing.updated_at = timestamp;
    return existing;
  }
  const created: ExpressionTemplateEntity = {
    expression_template_id: `expr_${type}_${randomUUID().slice(0, 8)}`,
    expression_template_name: payload.name,
    template_type: type,
    scene: "all",
    tone: payload.tone,
    avoid: payload.avoid,
    reason_limit: payload.reason_limit,
    system_role: payload.system_role,
    instruction: payload.instruction,
    style_hint: "从兼容 prompt 配置同步",
    status: "active",
    ...nowPair(),
  };
  store.expressionTemplates.push(created);
  return created;
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
  appendAudit({
    entity_type: "product",
    entity_id: created.sku_id,
    action: "create",
    summary: `新增商品 ${created.sku_name}`,
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
  appendAudit({
    entity_type: "product",
    entity_id: item.sku_id,
    action: "update",
    summary: `更新商品 ${item.sku_name}`,
  });
  return item;
}

export function softDeleteProduct(id: string) {
  const store = getMemoryStore();
  const item = findById(store.products, (record) => record.sku_id === id, "商品不存在");
  deleteWithStatusGuard(item, "商品");
  appendAudit({
    entity_type: "product",
    entity_id: item.sku_id,
    action: "toggle",
    summary: `停用商品 ${item.sku_name}`,
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
  appendAudit({
    entity_type: "dealer",
    entity_id: created.customer_id,
    action: "create",
    summary: `新增经销商 ${created.customer_name}`,
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
  appendAudit({
    entity_type: "dealer",
    entity_id: item.customer_id,
    action: "update",
    summary: `更新经销商 ${item.customer_name}`,
  });
  return item;
}

export function softDeleteDealer(id: string) {
  const store = getMemoryStore();
  const item = findById(store.dealers, (record) => record.customer_id === id, "经销商不存在");
  deleteWithStatusGuard(item, "经销商");
  appendAudit({
    entity_type: "dealer",
    entity_id: item.customer_id,
    action: "toggle",
    summary: `停用经销商 ${item.customer_name}`,
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
  appendAudit({
    entity_type: "campaign",
    entity_id: created.campaign_id,
    action: "create",
    summary: `新增活动 ${created.campaign_name}`,
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
  appendAudit({
    entity_type: "campaign",
    entity_id: item.campaign_id,
    action: "update",
    summary: `更新活动 ${item.campaign_name}`,
  });
  return item;
}

export function softDeleteCampaign(id: string) {
  const store = getMemoryStore();
  const item = findById(store.campaigns, (record) => record.campaign_id === id, "活动不存在");
  deleteWithStatusGuard(item, "活动");
  appendAudit({
    entity_type: "campaign",
    entity_id: item.campaign_id,
    action: "toggle",
    summary: `停用活动 ${item.campaign_name}`,
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
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: created.segment_id,
    action: "create",
    summary: `新增分群 ${created.segment_name}`,
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
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: item.segment_id,
    action: "update",
    summary: `更新分群 ${item.segment_name}`,
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
  appendAudit({
    entity_type: "dealer_segment",
    entity_id: item.segment_id,
    action: "toggle",
    summary: `停用分群 ${item.segment_name}`,
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
  appendAudit({
    entity_type: "product_pool",
    entity_id: created.pool_id,
    action: "create",
    summary: `新增商品池 ${created.pool_name}`,
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
  appendAudit({
    entity_type: "product_pool",
    entity_id: item.pool_id,
    action: "update",
    summary: `更新商品池 ${item.pool_name}`,
  });
  return item;
}

export function softDeleteProductPool(id: string) {
  const store = getMemoryStore();
  const item = findById(store.productPools, (record) => record.pool_id === id, "商品池不存在");
  deleteWithStatusGuard(item, "商品池");
  appendAudit({
    entity_type: "product_pool",
    entity_id: item.pool_id,
    action: "toggle",
    summary: `停用商品池 ${item.pool_name}`,
  });
  return item;
}

export function listRecommendationStrategies(
  query: ListQuery,
): ListResult<RecommendationStrategyEntity> {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.recommendationStrategies, {
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: created.strategy_id,
    action: "create",
    summary: `新增推荐策略 ${created.strategy_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: item.strategy_id,
    action: "update",
    summary: `更新推荐策略 ${item.strategy_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "recommendation_strategy",
    entity_id: item.strategy_id,
    action: "toggle",
    summary: `停用推荐策略 ${item.strategy_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "expression_template",
    entity_id: created.expression_template_id,
    action: "create",
    summary: `新增表达模板 ${created.expression_template_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "expression_template",
    entity_id: item.expression_template_id,
    action: "update",
    summary: `更新表达模板 ${item.expression_template_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "expression_template",
    entity_id: item.expression_template_id,
    action: "toggle",
    summary: `停用表达模板 ${item.expression_template_name}`,
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
  syncLegacyAdapters();
  appendAudit({
    entity_type: "global_rule",
    entity_id: store.globalRules.global_rule_id,
    action: "update",
    summary: `更新全局规则版本 ${store.globalRules.rule_version}`,
  });
  return store.globalRules;
}

export function listGenerationJobs(query: ListQuery): ListResult<GenerationJobEntity> {
  const store = getMemoryStore();
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
        page_name: "/procurement",
      });
      sampledCustomerIds.push(dealerId);
      generatedRunIds.push(result.summary.daily_run_id, result.summary.weekly_run_id);
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

function toPublishedSuggestionItems(
  run: RecommendationRunRecord | undefined,
  items: RecommendationItemRecord[],
): PublishedSuggestionItem[] {
  if (!run) {
    return [];
  }
  const openStatuses = new Set<RecommendationItemRecord["final_status"]>([
    "pending",
    "viewed",
    "explained",
  ]);

  return items
    .filter(
      (item) =>
        item.recommendation_run_id === run.recommendation_run_id &&
        openStatuses.has(item.final_status),
    )
    .sort((left, right) => left.suggested_rank - right.suggested_rank)
    .map((item) => ({
      recommendation_item_id: item.recommendation_item_id,
      sku_id: item.sku_id,
      sku_name: item.sku_name,
      suggested_qty: item.suggested_qty,
      reason: item.reason,
      reason_tags: item.reason_tags,
      priority: item.suggested_rank,
      action_type: item.action_type,
    }));
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
        (run.scene === "daily_recommendation" || run.scene === "weekly_focus")
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
    return {
      dailyRecommendations: [],
      weeklyFocusRecommendations: [],
      summary: {
        published: false,
      },
    };
  }

  const dailyRun = pickLatestRunByScene({
    runIds: selectedBatch.related_run_ids,
    customerId,
    scene: "daily_recommendation",
  });
  const weeklyRun = pickLatestRunByScene({
    runIds: selectedBatch.related_run_ids,
    customerId,
    scene: "weekly_focus",
  });

  return {
    dailyRecommendations: toPublishedSuggestionItems(dailyRun, store.recommendationItems),
    weeklyFocusRecommendations: toPublishedSuggestionItems(
      weeklyRun,
      store.recommendationItems,
    ),
    summary: {
      published: true,
      job_id: selectedJob?.job_id,
      batch_id: selectedBatch.batch_id,
      published_at:
        selectedJob?.published_at ?? selectedBatch.finished_at ?? selectedBatch.updated_at,
      trace_id: dailyRun?.trace_id ?? weeklyRun?.trace_id ?? selectedBatch.trace_id,
    },
  };
}

export function listRecommendationBatches(
  query: ListQuery,
  filters?: RecommendationBatchFilters,
): ListResult<RecommendationBatchRecord> {
  const store = getMemoryStore();
  let records = [...store.recommendationBatches];
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
  Object.assign(item, input, { updated_at: nowIso() });
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

  if (filters.dateFrom) {
    records = records.filter((item) => item.created_at >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    records = records.filter((item) => item.created_at <= filters.dateTo!);
  }
  if (filters.customerId) {
    records = records.filter((item) => item.customer_id === filters.customerId);
  }
  if (filters.scene) {
    records = records.filter((item) => item.scene === filters.scene);
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

export function getReportSummary() {
  syncLegacyAdapters();
  const store = getMemoryStore();
  const countActive = <T extends { status?: string; enabled?: boolean }>(items: T[]) =>
    items.filter((item) =>
      typeof item.enabled === "boolean" ? item.enabled : item.status === "active",
    ).length;

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
      suggestionTemplates: {
        total: store.suggestionTemplates.length,
        active: countActive(store.suggestionTemplates),
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

// ---------------------------------------------------------------------------
// Legacy adapters (old API contract) - backed by new source of truth.
// ---------------------------------------------------------------------------

export function listSuggestionTemplates(
  query: ListQuery,
): ListResult<DealerSuggestionTemplateEntity> {
  syncLegacyAdapters();
  const store = getMemoryStore();
  return filterSortAndPaginate(store.suggestionTemplates, {
    query,
    searchFields: ["template_id", "template_name", "customer_id", "scene"],
    statusResolver: (item) => (item.enabled ? "active" : "inactive"),
    defaultSortBy: "priority",
  });
}

export function getSuggestionTemplateById(id: string) {
  syncLegacyAdapters();
  const store = getMemoryStore();
  return store.suggestionTemplates.find((item) => item.template_id === id) ?? null;
}

export function createSuggestionTemplate(input: UpsertInput<DealerSuggestionTemplateEntity>) {
  const payload = legacyTemplateToStrategy(input);
  if (!payload.expression_template_id) {
    payload.expression_template_id = "expr_recommendation_default";
  }
  const strategy = createRecommendationStrategy(payload);
  syncLegacyAdapters();
  appendAudit({
    entity_type: "suggestion_template",
    entity_id: input.template_id,
    action: "create",
    summary: `新增兼容模板 ${input.template_name}`,
  });
  return strategyToLegacyTemplate(strategy, getMemoryStore().expressionTemplates);
}

export function updateSuggestionTemplate(
  id: string,
  input: Partial<UpsertInput<DealerSuggestionTemplateEntity>>,
) {
  const store = getMemoryStore();
  const current = findById(
    store.recommendationStrategies,
    (item) => item.strategy_id === id,
    "模板不存在",
  );

  const patch: Partial<UpsertInput<RecommendationStrategyEntity>> = {};
  if (input.template_name !== undefined) patch.strategy_name = input.template_name;
  if (input.scene !== undefined) patch.scene = input.scene;
  if (input.customer_id !== undefined) patch.target_dealer_ids = [input.customer_id];
  if (input.reference_items !== undefined) {
    patch.reference_items = input.reference_items;
    patch.candidate_sku_ids = input.reference_items.map((item) => item.sku_id);
  }
  if (input.business_notes !== undefined) patch.business_notes = input.business_notes;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.enabled !== undefined) patch.status = input.enabled ? "active" : "inactive";

  const strategy = updateRecommendationStrategy(current.strategy_id, patch);
  syncLegacyAdapters();
  appendAudit({
    entity_type: "suggestion_template",
    entity_id: id,
    action: "update",
    summary: `更新兼容模板 ${strategy.strategy_name}`,
  });
  return strategyToLegacyTemplate(strategy, getMemoryStore().expressionTemplates);
}

export function softDeleteSuggestionTemplate(id: string) {
  const strategy = softDeleteRecommendationStrategy(id);
  syncLegacyAdapters();
  appendAudit({
    entity_type: "suggestion_template",
    entity_id: id,
    action: "toggle",
    summary: `停用兼容模板 ${strategy.strategy_name}`,
  });
  return strategyToLegacyTemplate(strategy, getMemoryStore().expressionTemplates);
}

export function getPrompts() {
  syncLegacyAdapters();
  return getMemoryStore().promptConfig;
}

export function updatePrompts(input: PromptConfigEntity) {
  const store = getMemoryStore();

  upsertExpressionTemplateByType("recommendation", {
    name: "推荐表达模板",
    system_role: input.recommendation_prompt.system_role,
    instruction: input.recommendation_prompt.instruction,
    tone: input.global_style.tone,
    avoid: input.global_style.avoid,
    reason_limit: input.global_style.reason_limit,
  });

  upsertExpressionTemplateByType("cart_optimization", {
    name: "凑单优化表达模板",
    system_role: input.cart_opt_prompt.system_role,
    instruction: input.cart_opt_prompt.instruction,
    tone: input.global_style.tone,
    avoid: input.global_style.avoid,
    reason_limit: input.global_style.reason_limit,
  });

  upsertExpressionTemplateByType("explanation", {
    name: "解释表达模板",
    system_role: input.explain_prompt.system_role,
    instruction: input.explain_prompt.instruction,
    tone: input.global_style.tone,
    avoid: input.global_style.avoid,
    reason_limit: input.global_style.reason_limit,
  });

  store.promptConfig = input;
  syncLegacyAdapters();
  appendAudit({
    entity_type: "prompt",
    entity_id: "legacy_prompt_config",
    action: "update",
    summary: "更新兼容 Prompt 配置并同步表达模板",
  });
  return store.promptConfig;
}

export function getRules() {
  syncLegacyAdapters();
  return getMemoryStore().rules;
}

export function updateRules(input: RuleConfigEntity) {
  const store = getMemoryStore();
  store.globalRules = {
    ...store.globalRules,
    rule_version: `${new Date().toISOString().slice(0, 10)}.manual`,
    replenishment_days_threshold: input.replenishment_days_threshold,
    cart_gap_trigger_amount: input.cart_gap_trigger_amount,
    threshold_amount: input.threshold_amount,
    prefer_frequent_items: input.prefer_frequent_items,
    prefer_pair_items: input.prefer_pair_items,
    box_adjust_if_close: input.box_adjust_if_close,
    box_adjust_distance_limit: input.box_adjust_distance_limit,
    allow_new_product_recommendation: input.allow_new_product_recommendation,
    updated_at: nowIso(),
  };
  syncLegacyAdapters();
  appendAudit({
    entity_type: "rule",
    entity_id: store.globalRules.global_rule_id,
    action: "update",
    summary: "更新兼容规则配置并同步全局规则",
  });
  return store.rules;
}

// Keep name aliases for compatibility with frontstage/admin legacy report endpoints.
export const listRecommendationRecordsLegacy = listRecommendationRuns;
export const getRecommendationRecordDetailLegacy = getRecommendationRunDetail;

export function inferSceneFromActionType(
  actionType: TemplateReferenceItem["sort_order"] | number,
): SuggestionScene {
  if (actionType > 2) {
    return "box_pair_optimization";
  }
  return "daily_recommendation";
}
