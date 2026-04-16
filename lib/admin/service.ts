import { filterSortAndPaginate, type ListQuery } from "@/lib/admin/list-query";
import type {
  CampaignEntity,
  DealerEntity,
  DealerSuggestionTemplateEntity,
  ProductEntity,
  PromptConfigEntity,
  RecommendationItemRecord,
  RecommendationRunRecord,
  RuleConfigEntity,
} from "@/lib/memory/types";
import { appendAuditLog, appendMetricEvent, getMemoryStore, nowIso } from "@/lib/memory/store";

type ProductInput = Omit<ProductEntity, "created_at" | "updated_at">;
type DealerInput = Omit<DealerEntity, "created_at" | "updated_at">;
type TemplateInput = Omit<DealerSuggestionTemplateEntity, "created_at" | "updated_at">;
type CampaignInput = Omit<CampaignEntity, "created_at" | "updated_at">;

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

function ensureProductExists(skuId: string) {
  const store = getMemoryStore();
  if (!store.products.some((product) => product.sku_id === skuId)) {
    throw new AdminServiceError("VALIDATION_ERROR", `商品 ${skuId} 不存在`, 400, {
      sku_id: `商品 ${skuId} 不存在`,
    });
  }
}

function ensureDealerExists(customerId: string) {
  const store = getMemoryStore();
  if (!store.dealers.some((dealer) => dealer.customer_id === customerId)) {
    throw new AdminServiceError("VALIDATION_ERROR", `经销商 ${customerId} 不存在`, 400, {
      customer_id: `经销商 ${customerId} 不存在`,
    });
  }
}

function assertPairItemsExist(pairItems: string[]) {
  const store = getMemoryStore();
  const productIds = new Set(store.products.map((item) => item.sku_id));
  const missing = pairItems.filter((item) => !productIds.has(item));
  if (missing.length > 0) {
    throw new AdminServiceError("VALIDATION_ERROR", "搭配商品不存在", 400, {
      pair_items: `不存在的商品: ${missing.join(", ")}`,
    });
  }
}

function assertTemplateReferencesExist(referenceItems: TemplateInput["reference_items"]) {
  const store = getMemoryStore();
  const productIds = new Set(store.products.map((item) => item.sku_id));
  const missing = referenceItems
    .map((item) => item.sku_id)
    .filter((skuId) => !productIds.has(skuId));
  if (missing.length > 0) {
    throw new AdminServiceError("VALIDATION_ERROR", "模板中存在无效商品", 400, {
      reference_items: `不存在的 SKU: ${missing.join(", ")}`,
    });
  }
}

export function listProducts(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.products, {
    query,
    searchFields: ["sku_id", "sku_name", "brand", "category", "spec"],
    statusField: "status",
    defaultSortBy: "display_order",
  });
}

export function getProductById(id: string) {
  const store = getMemoryStore();
  return store.products.find((item) => item.sku_id === id) ?? null;
}

export function createProduct(input: ProductInput) {
  const store = getMemoryStore();
  if (store.products.some((item) => item.sku_id === input.sku_id)) {
    throw new AdminServiceError("CONFLICT", "商品 ID 已存在", 409, {
      sku_id: `${input.sku_id} 已存在`,
    });
  }
  assertPairItemsExist(input.pair_items);
  const timestamp = nowIso();
  const created: ProductEntity = {
    ...input,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.products.push(created);
  appendAuditLog({
    entity_type: "product",
    entity_id: created.sku_id,
    action: "create",
    summary: `创建商品 ${created.sku_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "product", entity_id: created.sku_id, action: "create" },
  });
  return created;
}

export function updateProduct(id: string, input: ProductInput) {
  const store = getMemoryStore();
  const target = store.products.find((item) => item.sku_id === id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "商品不存在", 404);
  }
  if (input.sku_id !== id) {
    throw new AdminServiceError("VALIDATION_ERROR", "不允许修改 sku_id", 400, {
      sku_id: "sku_id 不能修改",
    });
  }
  assertPairItemsExist(input.pair_items);
  const statusChanged = target.status !== input.status;
  Object.assign(target, input, { updated_at: nowIso() });
  const action = statusChanged ? "toggle" : "update";
  appendAuditLog({
    entity_type: "product",
    entity_id: target.sku_id,
    action,
    summary: statusChanged ? `切换商品状态 ${target.sku_name}` : `更新商品 ${target.sku_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "product", entity_id: target.sku_id, action },
  });
  return target;
}

export function softDeleteProduct(id: string) {
  const target = getProductById(id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "商品不存在", 404);
  }
  if (target.status === "inactive") {
    throw new AdminServiceError("CONFLICT", "商品已停用", 409);
  }
  target.status = "inactive";
  target.updated_at = nowIso();
  appendAuditLog({
    entity_type: "product",
    entity_id: target.sku_id,
    action: "delete",
    summary: `停用商品 ${target.sku_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "product", entity_id: target.sku_id, action: "delete" },
  });
  return target;
}

export function listDealers(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.dealers, {
    query,
    searchFields: ["customer_id", "customer_name", "city", "customer_type", "channel_type"],
    statusField: "status",
    defaultSortBy: "customer_name",
  });
}

export function getDealerById(id: string) {
  const store = getMemoryStore();
  return store.dealers.find((item) => item.customer_id === id) ?? null;
}

export function createDealer(input: DealerInput) {
  const store = getMemoryStore();
  if (store.dealers.some((item) => item.customer_id === input.customer_id)) {
    throw new AdminServiceError("CONFLICT", "经销商 ID 已存在", 409, {
      customer_id: `${input.customer_id} 已存在`,
    });
  }
  input.frequent_items.forEach(ensureProductExists);
  input.forbidden_items.forEach(ensureProductExists);
  const timestamp = nowIso();
  const created: DealerEntity = { ...input, created_at: timestamp, updated_at: timestamp };
  store.dealers.push(created);
  appendAuditLog({
    entity_type: "dealer",
    entity_id: created.customer_id,
    action: "create",
    summary: `创建经销商 ${created.customer_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "dealer", entity_id: created.customer_id, action: "create" },
  });
  return created;
}

export function updateDealer(id: string, input: DealerInput) {
  const store = getMemoryStore();
  const target = store.dealers.find((item) => item.customer_id === id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "经销商不存在", 404);
  }
  if (input.customer_id !== id) {
    throw new AdminServiceError("VALIDATION_ERROR", "不允许修改 customer_id", 400, {
      customer_id: "customer_id 不能修改",
    });
  }
  input.frequent_items.forEach(ensureProductExists);
  input.forbidden_items.forEach(ensureProductExists);
  const statusChanged = target.status !== input.status;
  Object.assign(target, input, { updated_at: nowIso() });
  const action = statusChanged ? "toggle" : "update";
  appendAuditLog({
    entity_type: "dealer",
    entity_id: target.customer_id,
    action,
    summary: statusChanged
      ? `切换经销商状态 ${target.customer_name}`
      : `更新经销商 ${target.customer_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "dealer", entity_id: target.customer_id, action },
  });
  return target;
}

export function softDeleteDealer(id: string) {
  const target = getDealerById(id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "经销商不存在", 404);
  }
  if (target.status === "inactive") {
    throw new AdminServiceError("CONFLICT", "经销商已停用", 409);
  }
  target.status = "inactive";
  target.updated_at = nowIso();
  appendAuditLog({
    entity_type: "dealer",
    entity_id: target.customer_id,
    action: "delete",
    summary: `停用经销商 ${target.customer_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "dealer", entity_id: target.customer_id, action: "delete" },
  });
  return target;
}

export function listSuggestionTemplates(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.suggestionTemplates, {
    query,
    searchFields: ["template_id", "template_name", "customer_id", "scene"],
    statusResolver: (item) => (item.enabled ? "active" : "inactive"),
    defaultSortBy: "priority",
  });
}

export function getSuggestionTemplateById(id: string) {
  const store = getMemoryStore();
  return store.suggestionTemplates.find((item) => item.template_id === id) ?? null;
}

export function createSuggestionTemplate(input: TemplateInput) {
  const store = getMemoryStore();
  if (store.suggestionTemplates.some((item) => item.template_id === input.template_id)) {
    throw new AdminServiceError("CONFLICT", "模板 ID 已存在", 409, {
      template_id: `${input.template_id} 已存在`,
    });
  }
  ensureDealerExists(input.customer_id);
  assertTemplateReferencesExist(input.reference_items);
  const timestamp = nowIso();
  const created: DealerSuggestionTemplateEntity = {
    ...input,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.suggestionTemplates.push(created);
  appendAuditLog({
    entity_type: "suggestion_template",
    entity_id: created.template_id,
    action: "create",
    summary: `创建建议模板 ${created.template_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: {
      entity_type: "suggestion_template",
      entity_id: created.template_id,
      action: "create",
    },
  });
  return created;
}

export function updateSuggestionTemplate(id: string, input: TemplateInput) {
  const store = getMemoryStore();
  const target = store.suggestionTemplates.find((item) => item.template_id === id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "模板不存在", 404);
  }
  if (input.template_id !== id) {
    throw new AdminServiceError("VALIDATION_ERROR", "不允许修改 template_id", 400, {
      template_id: "template_id 不能修改",
    });
  }
  ensureDealerExists(input.customer_id);
  assertTemplateReferencesExist(input.reference_items);
  const statusChanged = target.enabled !== input.enabled;
  Object.assign(target, input, { updated_at: nowIso() });
  const action = statusChanged ? "toggle" : "update";
  appendAuditLog({
    entity_type: "suggestion_template",
    entity_id: target.template_id,
    action,
    summary: statusChanged
      ? `切换建议模板状态 ${target.template_name}`
      : `更新建议模板 ${target.template_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: {
      entity_type: "suggestion_template",
      entity_id: target.template_id,
      action,
    },
  });
  return target;
}

export function softDeleteSuggestionTemplate(id: string) {
  const target = getSuggestionTemplateById(id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "模板不存在", 404);
  }
  if (!target.enabled) {
    throw new AdminServiceError("CONFLICT", "模板已停用", 409);
  }
  target.enabled = false;
  target.updated_at = nowIso();
  appendAuditLog({
    entity_type: "suggestion_template",
    entity_id: target.template_id,
    action: "delete",
    summary: `停用建议模板 ${target.template_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: {
      entity_type: "suggestion_template",
      entity_id: target.template_id,
      action: "delete",
    },
  });
  return target;
}

export function listCampaigns(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.campaigns, {
    query,
    searchFields: ["campaign_id", "campaign_name", "week_id", "promo_type"],
    statusField: "status",
    defaultSortBy: "week_id",
  });
}

export function getCampaignById(id: string) {
  const store = getMemoryStore();
  return store.campaigns.find((item) => item.campaign_id === id) ?? null;
}

export function createCampaign(input: CampaignInput) {
  const store = getMemoryStore();
  if (store.campaigns.some((item) => item.campaign_id === input.campaign_id)) {
    throw new AdminServiceError("CONFLICT", "活动 ID 已存在", 409, {
      campaign_id: `${input.campaign_id} 已存在`,
    });
  }
  input.weekly_focus_items.forEach(ensureProductExists);
  const timestamp = nowIso();
  const created: CampaignEntity = { ...input, created_at: timestamp, updated_at: timestamp };
  store.campaigns.push(created);
  appendAuditLog({
    entity_type: "campaign",
    entity_id: created.campaign_id,
    action: "create",
    summary: `创建活动 ${created.campaign_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "campaign", entity_id: created.campaign_id, action: "create" },
  });
  return created;
}

export function updateCampaign(id: string, input: CampaignInput) {
  const store = getMemoryStore();
  const target = store.campaigns.find((item) => item.campaign_id === id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "活动不存在", 404);
  }
  if (input.campaign_id !== id) {
    throw new AdminServiceError("VALIDATION_ERROR", "不允许修改 campaign_id", 400, {
      campaign_id: "campaign_id 不能修改",
    });
  }
  input.weekly_focus_items.forEach(ensureProductExists);
  const statusChanged = target.status !== input.status;
  Object.assign(target, input, { updated_at: nowIso() });
  const action = statusChanged ? "toggle" : "update";
  appendAuditLog({
    entity_type: "campaign",
    entity_id: target.campaign_id,
    action,
    summary: statusChanged
      ? `切换活动状态 ${target.campaign_name}`
      : `更新活动 ${target.campaign_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "campaign", entity_id: target.campaign_id, action },
  });
  return target;
}

export function softDeleteCampaign(id: string) {
  const target = getCampaignById(id);
  if (!target) {
    throw new AdminServiceError("NOT_FOUND", "活动不存在", 404);
  }
  if (target.status === "inactive") {
    throw new AdminServiceError("CONFLICT", "活动已停用", 409);
  }
  target.status = "inactive";
  target.updated_at = nowIso();
  appendAuditLog({
    entity_type: "campaign",
    entity_id: target.campaign_id,
    action: "delete",
    summary: `停用活动 ${target.campaign_name}`,
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "campaign", entity_id: target.campaign_id, action: "delete" },
  });
  return target;
}

export function getRules() {
  return getMemoryStore().rules;
}

export function updateRules(input: RuleConfigEntity) {
  const store = getMemoryStore();
  store.rules = input;
  appendAuditLog({
    entity_type: "rule",
    entity_id: "rules",
    action: "update",
    summary: "更新规则配置",
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "rule", entity_id: "rules", action: "update" },
  });
  return store.rules;
}

export function getPrompts() {
  return getMemoryStore().promptConfig;
}

export function updatePrompts(input: PromptConfigEntity) {
  const store = getMemoryStore();
  store.promptConfig = input;
  appendAuditLog({
    entity_type: "prompt",
    entity_id: "prompts",
    action: "update",
    summary: "更新 Prompt 配置",
  });
  appendMetricEvent({
    customerId: "admin",
    customerName: "admin",
    eventType: "config_updated",
    scene: "admin_config",
    payload: { entity_type: "prompt", entity_id: "prompts", action: "update" },
  });
  return store.promptConfig;
}

export function getReportSummary() {
  const store = getMemoryStore();
  const activeProducts = store.products.filter((item) => item.status === "active").length;
  const activeDealers = store.dealers.filter((item) => item.status === "active").length;
  const activeTemplates = store.suggestionTemplates.filter((item) => item.enabled).length;
  const activeCampaigns = store.campaigns.filter((item) => item.status === "active").length;

  return {
    entities: {
      products: { total: store.products.length, active: activeProducts },
      dealers: { total: store.dealers.length, active: activeDealers },
      suggestionTemplates: { total: store.suggestionTemplates.length, active: activeTemplates },
      campaigns: { total: store.campaigns.length, active: activeCampaigns },
    },
    metrics: store.metrics,
    recommendationRuns: {
      total: store.recommendationRuns.length,
      generated: store.recommendationRuns.filter((item) => item.status === "generated").length,
      partiallyApplied: store.recommendationRuns.filter(
        (item) => item.status === "partially_applied",
      ).length,
      fullyApplied: store.recommendationRuns.filter((item) => item.status === "fully_applied")
        .length,
      ignored: store.recommendationRuns.filter((item) => item.status === "ignored").length,
    },
  };
}

export function listReportEvents(query: ListQuery) {
  const store = getMemoryStore();
  return filterSortAndPaginate(store.metrics.latestEvents, {
    query,
    searchFields: ["eventType", "customerId", "customerName", "scene"],
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

type RecommendationReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  scene?: string;
  skuId?: string;
  adoptionStatus?: string;
  modelName?: string;
};

export function listRecommendationRuns(
  query: ListQuery,
  filters: RecommendationReportFilters,
) {
  const store = getMemoryStore();
  let runs = [...store.recommendationRuns];

  if (filters.dateFrom) {
    runs = runs.filter((item) => item.created_at >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    runs = runs.filter((item) => item.created_at <= filters.dateTo!);
  }
  if (filters.customerId) {
    runs = runs.filter((item) => item.customer_id === filters.customerId);
  }
  if (filters.scene) {
    runs = runs.filter((item) => item.scene === filters.scene);
  }
  if (filters.modelName) {
    const expected = filters.modelName.toLowerCase();
    runs = runs.filter((item) => item.model_name.toLowerCase().includes(expected));
  }
  if (filters.skuId) {
    runs = runs.filter((item) => item.returned_sku_ids.includes(filters.skuId!));
  }
  if (filters.adoptionStatus) {
    if (filters.adoptionStatus === "adopted") {
      runs = runs.filter((item) =>
        ["partially_applied", "fully_applied"].includes(item.status),
      );
    } else if (filters.adoptionStatus === "not_adopted") {
      runs = runs.filter((item) => ["generated", "ignored"].includes(item.status));
    } else {
      runs = runs.filter((item) => item.status === filters.adoptionStatus);
    }
  }

  return filterSortAndPaginate(runs, {
    query,
    searchFields: [
      "recommendation_run_id",
      "customer_id",
      "customer_name",
      "scene",
      "status",
      "model_name",
    ],
    statusField: "status",
    defaultSortBy: "created_at",
  });
}

export function getRecommendationRunDetail(id: string): {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
} | null {
  const store = getMemoryStore();
  const run = store.recommendationRuns.find((item) => item.recommendation_run_id === id);
  if (!run) {
    return null;
  }
  const items = store.recommendationItems.filter(
    (item) => item.recommendation_run_id === run.recommendation_run_id,
  );
  return { run, items };
}
