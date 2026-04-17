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
  RecommendationBatchRecord,
  RecommendationStrategyEntity,
  PromptConfigEntity,
  RuleConfigEntity,
  TemplateReferenceItem,
  RecoverySnapshotRecord,
} from "@/lib/memory/types";

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; fieldErrors: Record<string, string> };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function toCanonicalStringList(
  value: unknown,
  fieldErrors: Record<string, string>,
  fieldName: string,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fieldErrors[fieldName] = `${fieldName} 必须为字符串数组`;
    return [];
  }
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseEntityStatus(value: unknown): "active" | "inactive" {
  return String(value ?? "active") === "inactive" ? "inactive" : "active";
}

function isValidScene(value: string) {
  return (
    value === "daily_recommendation" ||
    value === "weekly_focus" ||
    value === "threshold_topup" ||
    value === "box_pair_optimization"
  );
}

export function validateProductInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<
  Omit<ProductEntity, "created_at" | "updated_at"> &
    Partial<Pick<ProductEntity, "created_at" | "updated_at">>
> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const sku_id = String(body.sku_id ?? "").trim();
  const sku_name = String(body.sku_name ?? "").trim();
  const brand = String(body.brand ?? "厨邦").trim();
  const category = String(body.category ?? "").trim();
  const spec = String(body.spec ?? "").trim();
  const price_per_case = parseNumber(body.price_per_case);
  const box_multiple = parseNumber(body.box_multiple);
  const tags = toStringList(body.tags);
  const pair_items = toStringList(body.pair_items);
  const is_weekly_focus = parseBoolean(body.is_weekly_focus);
  const is_new_product = parseBoolean(body.is_new_product);
  const statusRaw = String(body.status ?? "active").trim();
  const display_order = parseNumber(body.display_order, 999);

  if (mode === "create" && !isNonEmptyString(sku_id)) {
    fieldErrors.sku_id = "SKU ID 不能为空";
  }
  if (!isNonEmptyString(sku_name)) {
    fieldErrors.sku_name = "商品名称不能为空";
  }
  if (!isNonEmptyString(category)) {
    fieldErrors.category = "品类不能为空";
  }
  if (!isNonEmptyString(spec)) {
    fieldErrors.spec = "规格不能为空";
  }
  if (price_per_case <= 0) {
    fieldErrors.price_per_case = "单箱价格必须大于 0";
  }
  if (box_multiple <= 0) {
    fieldErrors.box_multiple = "箱规必须大于 0";
  }
  if (statusRaw !== "active" && statusRaw !== "inactive") {
    fieldErrors.status = "状态必须为 active 或 inactive";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  const status = statusRaw as ProductEntity["status"];

  return {
    valid: true,
    value: {
      sku_id,
      sku_name,
      brand,
      category,
      spec,
      price_per_case,
      box_multiple,
      tags,
      pair_items,
      is_weekly_focus,
      is_new_product,
      status,
      display_order,
    },
  };
}

export function validateDealerInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<DealerEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const customer_id = String(body.customer_id ?? "").trim();
  const customer_name = String(body.customer_name ?? "").trim();
  const city = String(body.city ?? "").trim();
  const customer_type = String(body.customer_type ?? "").trim();
  const channel_type = String(body.channel_type ?? "").trim();
  const store_count_hint = String(body.store_count_hint ?? "").trim();
  const last_order_days_ago = parseNumber(body.last_order_days_ago);
  const order_frequency = String(body.order_frequency ?? "").trim();
  const price_sensitivity = String(body.price_sensitivity ?? "中") as DealerEntity["price_sensitivity"];
  const new_product_acceptance = String(body.new_product_acceptance ?? "中") as DealerEntity["new_product_acceptance"];
  const frequent_items = toStringList(body.frequent_items);
  const forbidden_items = toStringList(body.forbidden_items);
  const preferred_categories = toStringList(body.preferred_categories);
  const business_traits = toStringList(body.business_traits);
  const status = String(body.status ?? "active") as DealerEntity["status"];

  if (mode === "create" && !isNonEmptyString(customer_id)) {
    fieldErrors.customer_id = "经销商 ID 不能为空";
  }
  if (!isNonEmptyString(customer_name)) {
    fieldErrors.customer_name = "经销商名称不能为空";
  }
  if (frequent_items.length < 1) {
    fieldErrors.frequent_items = "常购商品至少 1 个";
  }
  if (!isNonEmptyString(city)) {
    fieldErrors.city = "城市不能为空";
  }
  if (last_order_days_ago < 0) {
    fieldErrors.last_order_days_ago = "最近下单天数不能为负数";
  }
  if (status !== "active" && status !== "inactive") {
    fieldErrors.status = "状态必须为 active 或 inactive";
  }

  const overlap = frequent_items.filter((item) => forbidden_items.includes(item));
  if (overlap.length > 0) {
    fieldErrors.forbidden_items = `禁推商品与常购商品冲突: ${overlap.join(", ")}`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      customer_id,
      customer_name,
      city,
      customer_type,
      channel_type,
      store_count_hint,
      last_order_days_ago,
      order_frequency,
      price_sensitivity,
      new_product_acceptance,
      frequent_items,
      forbidden_items,
      preferred_categories,
      business_traits,
      status,
    },
  };
}

function parseReferenceItems(value: unknown): TemplateReferenceItem[] {
  if (Array.isArray(value)) {
    return value as TemplateReferenceItem[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed as TemplateReferenceItem[];
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function validateTemplateInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<DealerSuggestionTemplateEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const template_id = String(body.template_id ?? "").trim();
  const customer_id = String(body.customer_id ?? "").trim();
  const template_name = String(body.template_name ?? "").trim();
  const scene = String(body.scene ?? "") as DealerSuggestionTemplateEntity["scene"];
  const reference_items = parseReferenceItems(body.reference_items);
  const business_notes = String(body.business_notes ?? "").trim();
  const style_hint = String(body.style_hint ?? "").trim();
  const priority = parseNumber(body.priority, 1);
  const enabled = parseBoolean(body.enabled);

  const validScenes = new Set([
    "daily_recommendation",
    "weekly_focus",
    "threshold_topup",
    "box_pair_optimization",
  ]);

  if (mode === "create" && !isNonEmptyString(template_id)) {
    fieldErrors.template_id = "模板 ID 不能为空";
  }
  if (!isNonEmptyString(customer_id)) {
    fieldErrors.customer_id = "经销商不能为空";
  }
  if (!isNonEmptyString(template_name)) {
    fieldErrors.template_name = "模板名称不能为空";
  }
  if (!validScenes.has(scene)) {
    fieldErrors.scene = "模板场景不合法";
  }
  if (!isNonEmptyString(business_notes)) {
    fieldErrors.business_notes = "业务说明不能为空";
  }
  if (!isNonEmptyString(style_hint)) {
    fieldErrors.style_hint = "风格提示不能为空";
  }
  if (reference_items.length < 1) {
    fieldErrors.reference_items = "至少需要 1 条参考商品";
  } else {
    for (let i = 0; i < reference_items.length; i += 1) {
      const item = reference_items[i];
      if (!isNonEmptyString(item?.sku_id)) {
        fieldErrors[`reference_items[${i}].sku_id`] = "sku_id 不能为空";
      }
      if (!Number.isFinite(item?.qty) || item.qty <= 0) {
        fieldErrors[`reference_items[${i}].qty`] = "qty 必须大于 0";
      }
      if (!isNonEmptyString(item?.reason)) {
        fieldErrors[`reference_items[${i}].reason`] = "reason 不能为空";
      }
      if (!Array.isArray(item?.reason_tags)) {
        fieldErrors[`reference_items[${i}].reason_tags`] = "reason_tags 必须为数组";
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      template_id,
      customer_id,
      template_name,
      scene,
      reference_items,
      business_notes,
      style_hint,
      priority,
      enabled,
    },
  };
}

export function validateCampaignInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<CampaignEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const campaign_id = String(body.campaign_id ?? "").trim();
  const week_id = String(body.week_id ?? "").trim();
  const campaign_name = String(body.campaign_name ?? "").trim();
  const weekly_focus_items = toCanonicalStringList(
    body.weekly_focus_items,
    fieldErrors,
    "weekly_focus_items",
  );
  const product_pool_ids = toCanonicalStringList(
    body.product_pool_ids,
    fieldErrors,
    "product_pool_ids",
  );
  const promo_threshold = parseNumber(body.promo_threshold, 0);
  const promo_type = String(body.promo_type ?? "").trim();
  const activity_notes = toCanonicalStringList(
    body.activity_notes,
    fieldErrors,
    "activity_notes",
  );
  const target_dealer_ids = toCanonicalStringList(
    body.target_dealer_ids,
    fieldErrors,
    "target_dealer_ids",
  );
  const target_segment_ids = toCanonicalStringList(
    body.target_segment_ids,
    fieldErrors,
    "target_segment_ids",
  );
  const target_customer_types = toStringList(body.target_customer_types);
  const status = String(body.status ?? "active") as CampaignEntity["status"];

  if (mode === "create" && !isNonEmptyString(campaign_id)) {
    fieldErrors.campaign_id = "活动 ID 不能为空";
  }
  if (!isNonEmptyString(week_id)) {
    fieldErrors.week_id = "week_id 不能为空";
  }
  if (!isNonEmptyString(campaign_name)) {
    fieldErrors.campaign_name = "活动名称不能为空";
  }
  if (weekly_focus_items.length === 0 && product_pool_ids.length === 0) {
    fieldErrors.campaign_scope = "weekly_focus_items 或 product_pool_ids 至少提供一个";
  }
  if (
    target_dealer_ids.length === 0 &&
    target_segment_ids.length === 0 &&
    target_customer_types.length === 0
  ) {
    fieldErrors.target_scope =
      "target_dealer_ids、target_segment_ids、target_customer_types 至少提供一个";
  }
  if (!isNonEmptyString(promo_type)) {
    fieldErrors.promo_type = "活动类型不能为空";
  }
  if (promo_threshold < 0) {
    fieldErrors.promo_threshold = "门槛金额不能小于 0";
  }
  if (status !== "active" && status !== "inactive") {
    fieldErrors.status = "状态必须为 active 或 inactive";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      campaign_id,
      week_id,
      campaign_name,
      weekly_focus_items,
      product_pool_ids,
      promo_threshold,
      promo_type,
      activity_notes,
      target_dealer_ids,
      target_segment_ids,
      target_customer_types,
      status,
    },
  };
}

export function validateRulesInput(payload: unknown): ValidationResult<RuleConfigEntity> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const rules: RuleConfigEntity = {
    replenishment_days_threshold: parseNumber(body.replenishment_days_threshold),
    cart_gap_trigger_amount: parseNumber(body.cart_gap_trigger_amount),
    threshold_amount: parseNumber(body.threshold_amount),
    prefer_frequent_items: parseBoolean(body.prefer_frequent_items),
    prefer_pair_items: parseBoolean(body.prefer_pair_items),
    box_adjust_if_close: parseBoolean(body.box_adjust_if_close),
    box_adjust_distance_limit: parseNumber(body.box_adjust_distance_limit),
    allow_new_product_recommendation: parseBoolean(
      body.allow_new_product_recommendation,
    ),
  };

  if (rules.replenishment_days_threshold <= 0) {
    fieldErrors.replenishment_days_threshold = "补货阈值天数必须大于 0";
  }
  if (rules.threshold_amount <= 0) {
    fieldErrors.threshold_amount = "门槛金额必须大于 0";
  }
  if (rules.cart_gap_trigger_amount < 0) {
    fieldErrors.cart_gap_trigger_amount = "触发差额不能为负数";
  }
  if (rules.box_adjust_distance_limit < 0) {
    fieldErrors.box_adjust_distance_limit = "箱规接近阈值不能为负数";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return { valid: true, value: rules };
}

export function validatePromptConfigInput(
  payload: unknown,
): ValidationResult<PromptConfigEntity> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const global_style = (body.global_style ?? {}) as Record<string, unknown>;
  const recommendation_prompt = (body.recommendation_prompt ?? {}) as Record<
    string,
    unknown
  >;
  const cart_opt_prompt = (body.cart_opt_prompt ?? {}) as Record<string, unknown>;
  const explain_prompt = (body.explain_prompt ?? {}) as Record<string, unknown>;

  const value: PromptConfigEntity = {
    global_style: {
      tone: String(global_style.tone ?? "").trim(),
      avoid: toStringList(global_style.avoid),
      reason_limit: parseNumber(global_style.reason_limit),
    },
    recommendation_prompt: {
      system_role: String(recommendation_prompt.system_role ?? "").trim(),
      instruction: String(recommendation_prompt.instruction ?? "").trim(),
    },
    cart_opt_prompt: {
      system_role: String(cart_opt_prompt.system_role ?? "").trim(),
      instruction: String(cart_opt_prompt.instruction ?? "").trim(),
    },
    explain_prompt: {
      system_role: String(explain_prompt.system_role ?? "").trim(),
      instruction: String(explain_prompt.instruction ?? "").trim(),
    },
  };

  if (!isNonEmptyString(value.global_style.tone)) {
    fieldErrors["global_style.tone"] = "tone 不能为空";
  }
  if (value.global_style.reason_limit <= 0) {
    fieldErrors["global_style.reason_limit"] = "reason_limit 必须大于 0";
  }
  if (!isNonEmptyString(value.recommendation_prompt.system_role)) {
    fieldErrors["recommendation_prompt.system_role"] = "推荐 system_role 不能为空";
  }
  if (!isNonEmptyString(value.recommendation_prompt.instruction)) {
    fieldErrors["recommendation_prompt.instruction"] = "推荐 instruction 不能为空";
  }
  if (!isNonEmptyString(value.cart_opt_prompt.system_role)) {
    fieldErrors["cart_opt_prompt.system_role"] = "凑单 system_role 不能为空";
  }
  if (!isNonEmptyString(value.cart_opt_prompt.instruction)) {
    fieldErrors["cart_opt_prompt.instruction"] = "凑单 instruction 不能为空";
  }
  if (!isNonEmptyString(value.explain_prompt.system_role)) {
    fieldErrors["explain_prompt.system_role"] = "解释 system_role 不能为空";
  }
  if (!isNonEmptyString(value.explain_prompt.instruction)) {
    fieldErrors["explain_prompt.instruction"] = "解释 instruction 不能为空";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return { valid: true, value };
}

export function validateDealerSegmentInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<DealerSegmentEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const segment_id = String(body.segment_id ?? "").trim();
  const segment_name = String(body.segment_name ?? "").trim();
  const description = String(body.description ?? "").trim();
  const city_list = toCanonicalStringList(body.city_list, fieldErrors, "city_list");
  const customer_types = toCanonicalStringList(
    body.customer_types,
    fieldErrors,
    "customer_types",
  );
  const channel_types = toCanonicalStringList(
    body.channel_types,
    fieldErrors,
    "channel_types",
  );
  const dealer_ids = toCanonicalStringList(body.dealer_ids, fieldErrors, "dealer_ids");
  const status = parseEntityStatus(body.status);

  if (mode === "create" && !isNonEmptyString(segment_id)) {
    fieldErrors.segment_id = "segment_id 不能为空";
  }
  if (!isNonEmptyString(segment_name)) {
    fieldErrors.segment_name = "segment_name 不能为空";
  }
  if (
    city_list.length === 0 &&
    customer_types.length === 0 &&
    channel_types.length === 0 &&
    dealer_ids.length === 0
  ) {
    fieldErrors.segment_scope = "至少提供一种分群条件";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      segment_id,
      segment_name,
      description,
      city_list,
      customer_types,
      channel_types,
      dealer_ids,
      status,
    },
  };
}

export function validateProductPoolInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<ProductPoolEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const pool_id = String(body.pool_id ?? "").trim();
  const pool_name = String(body.pool_name ?? "").trim();
  const pool_type = String(body.pool_type ?? "").trim() as ProductPoolEntity["pool_type"];
  const description = String(body.description ?? "").trim();
  const sku_ids = toCanonicalStringList(body.sku_ids, fieldErrors, "sku_ids");
  const pair_sku_ids = toCanonicalStringList(
    body.pair_sku_ids,
    fieldErrors,
    "pair_sku_ids",
  );
  const status = parseEntityStatus(body.status);

  if (mode === "create" && !isNonEmptyString(pool_id)) {
    fieldErrors.pool_id = "pool_id 不能为空";
  }
  if (!isNonEmptyString(pool_name)) {
    fieldErrors.pool_name = "pool_name 不能为空";
  }
  if (
    !["regular", "hot_sale", "new_product", "campaign", "pairing"].includes(pool_type)
  ) {
    fieldErrors.pool_type = "pool_type 不合法";
  }
  if (sku_ids.length < 1) {
    fieldErrors.sku_ids = "至少提供一个 sku_id";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      pool_id,
      pool_name,
      pool_type,
      description,
      sku_ids,
      pair_sku_ids,
      status,
    },
  };
}

export function validateRecommendationStrategyInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<RecommendationStrategyEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const strategy_id = String(body.strategy_id ?? "").trim();
  const strategy_name = String(body.strategy_name ?? "").trim();
  const scene = String(body.scene ?? "").trim() as RecommendationStrategyEntity["scene"];
  const target_dealer_ids = toCanonicalStringList(
    body.target_dealer_ids,
    fieldErrors,
    "target_dealer_ids",
  );
  const dealer_segment_ids = toCanonicalStringList(
    body.dealer_segment_ids,
    fieldErrors,
    "dealer_segment_ids",
  );
  const product_pool_ids = toCanonicalStringList(
    body.product_pool_ids,
    fieldErrors,
    "product_pool_ids",
  );
  const campaign_ids = toCanonicalStringList(
    body.campaign_ids,
    fieldErrors,
    "campaign_ids",
  );
  const candidate_sku_ids = toCanonicalStringList(
    body.candidate_sku_ids,
    fieldErrors,
    "candidate_sku_ids",
  );
  const expression_template_id = String(body.expression_template_id ?? "").trim();
  const business_notes = String(body.business_notes ?? "").trim();
  const priority = parseNumber(body.priority, 1);
  const status = parseEntityStatus(body.status);

  let reference_items: TemplateReferenceItem[] = [];
  if (body.reference_items === undefined || body.reference_items === null) {
    reference_items = [];
  } else if (Array.isArray(body.reference_items)) {
    reference_items = body.reference_items as TemplateReferenceItem[];
  } else {
    fieldErrors.reference_items = "reference_items 必须为对象数组";
  }

  if (mode === "create" && !isNonEmptyString(strategy_id)) {
    fieldErrors.strategy_id = "strategy_id 不能为空";
  }
  if (!isNonEmptyString(strategy_name)) {
    fieldErrors.strategy_name = "strategy_name 不能为空";
  }
  if (!isValidScene(scene)) {
    fieldErrors.scene = "scene 不合法";
  }
  if (target_dealer_ids.length === 0 && dealer_segment_ids.length === 0) {
    fieldErrors.target_scope = "target_dealer_ids / dealer_segment_ids 至少提供一个";
  }
  if (product_pool_ids.length === 0) {
    fieldErrors.product_pool_ids = "至少关联一个 product_pool";
  }
  if (!isNonEmptyString(expression_template_id)) {
    fieldErrors.expression_template_id = "expression_template_id 不能为空";
  }
  if (priority <= 0) {
    fieldErrors.priority = "priority 必须大于 0";
  }
  if (reference_items.length === 0) {
    fieldErrors.reference_items = "至少提供 1 条 reference_items";
  } else {
    for (let i = 0; i < reference_items.length; i += 1) {
      const item = reference_items[i];
      if (!isNonEmptyString(item?.sku_id)) {
        fieldErrors[`reference_items[${i}].sku_id`] = "sku_id 不能为空";
      }
      if (!Number.isFinite(item?.qty) || item.qty <= 0) {
        fieldErrors[`reference_items[${i}].qty`] = "qty 必须大于 0";
      }
      if (!isNonEmptyString(item?.reason)) {
        fieldErrors[`reference_items[${i}].reason`] = "reason 不能为空";
      }
      if (!Array.isArray(item?.reason_tags)) {
        fieldErrors[`reference_items[${i}].reason_tags`] = "reason_tags 必须为数组";
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      strategy_id,
      strategy_name,
      scene,
      target_dealer_ids,
      dealer_segment_ids,
      product_pool_ids,
      campaign_ids,
      candidate_sku_ids,
      reference_items,
      business_notes,
      expression_template_id,
      priority,
      status,
    },
  };
}

export function validateExpressionTemplateInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<ExpressionTemplateEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const expression_template_id = String(body.expression_template_id ?? "").trim();
  const expression_template_name = String(body.expression_template_name ?? "").trim();
  const template_type = String(
    body.template_type ?? "",
  ).trim() as ExpressionTemplateEntity["template_type"];
  const scene = String(body.scene ?? "all").trim() as ExpressionTemplateEntity["scene"];
  const tone = String(body.tone ?? "").trim();
  const avoid = toCanonicalStringList(body.avoid, fieldErrors, "avoid");
  const reason_limit = parseNumber(body.reason_limit, 3);
  const system_role = String(body.system_role ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();
  const style_hint = String(body.style_hint ?? "").trim();
  const status = parseEntityStatus(body.status);

  if (mode === "create" && !isNonEmptyString(expression_template_id)) {
    fieldErrors.expression_template_id = "expression_template_id 不能为空";
  }
  if (!isNonEmptyString(expression_template_name)) {
    fieldErrors.expression_template_name = "expression_template_name 不能为空";
  }
  if (!["recommendation", "cart_optimization", "explanation"].includes(template_type)) {
    fieldErrors.template_type = "template_type 不合法";
  }
  if (!(scene === "all" || isValidScene(scene))) {
    fieldErrors.scene = "scene 不合法";
  }
  if (!isNonEmptyString(tone)) {
    fieldErrors.tone = "tone 不能为空";
  }
  if (!isNonEmptyString(system_role)) {
    fieldErrors.system_role = "system_role 不能为空";
  }
  if (!isNonEmptyString(instruction)) {
    fieldErrors.instruction = "instruction 不能为空";
  }
  if (reason_limit <= 0) {
    fieldErrors.reason_limit = "reason_limit 必须大于 0";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      expression_template_id,
      expression_template_name,
      template_type,
      scene,
      tone,
      avoid,
      reason_limit,
      system_role,
      instruction,
      style_hint,
      status,
    },
  };
}

export function validateGlobalRulesInput(
  payload: unknown,
): ValidationResult<Omit<GlobalRuleEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const rules = validateRulesInput(payload);
  if (!rules.valid) {
    return rules as ValidationResult<Omit<GlobalRuleEntity, "created_at" | "updated_at">>;
  }

  return {
    valid: true,
    value: {
      global_rule_id: String(body.global_rule_id ?? "global_rules_default"),
      rule_version: String(body.rule_version ?? "manual"),
      ...rules.value,
      status: parseEntityStatus(body.status),
    },
  };
}

export function validateGenerationJobInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<GenerationJobEntity, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const job_id = String(body.job_id ?? "").trim();
  const job_name = String(body.job_name ?? "").trim();
  const business_date = String(body.business_date ?? "").trim();
  const target_dealer_ids = toCanonicalStringList(
    body.target_dealer_ids,
    fieldErrors,
    "target_dealer_ids",
  );
  const target_segment_ids = toCanonicalStringList(
    body.target_segment_ids,
    fieldErrors,
    "target_segment_ids",
  );
  const strategy_ids = toCanonicalStringList(body.strategy_ids, fieldErrors, "strategy_ids");
  const publish_mode = String(body.publish_mode ?? "manual").trim() as
    | "manual"
    | "auto";
  const status = String(body.status ?? "draft").trim() as GenerationJobEntity["status"];
  const publication_status = String(
    body.publication_status ?? "unpublished",
  ).trim() as GenerationJobEntity["publication_status"];
  const precheck_summary = String(body.precheck_summary ?? "").trim();
  const last_precheck_at = String(body.last_precheck_at ?? "").trim() || undefined;
  const last_sample_batch_id =
    String(body.last_sample_batch_id ?? "").trim() || undefined;
  const last_batch_id = String(body.last_batch_id ?? "").trim() || undefined;
  const published_batch_id =
    String(body.published_batch_id ?? "").trim() || undefined;
  const published_at = String(body.published_at ?? "").trim() || undefined;

  if (mode === "create" && !isNonEmptyString(job_id)) {
    fieldErrors.job_id = "job_id 不能为空";
  }
  if (!isNonEmptyString(job_name)) {
    fieldErrors.job_name = "job_name 不能为空";
  }
  if (!isNonEmptyString(business_date)) {
    fieldErrors.business_date = "business_date 不能为空";
  }
  if (strategy_ids.length === 0) {
    fieldErrors.strategy_ids = "至少关联一个 strategy_id";
  }
  if (!["manual", "auto"].includes(publish_mode)) {
    fieldErrors.publish_mode = "publish_mode 不合法";
  }
  if (
    ![
      "draft",
      "prechecking",
      "ready",
      "running",
      "completed",
      "failed",
      "cancelled",
    ].includes(status)
  ) {
    fieldErrors.status = "status 不合法";
  }
  if (!["unpublished", "ready", "published"].includes(publication_status)) {
    fieldErrors.publication_status = "publication_status 不合法";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      job_id,
      job_name,
      business_date,
      target_dealer_ids,
      target_segment_ids,
      strategy_ids,
      publish_mode,
      status,
      publication_status,
      precheck_summary,
      last_precheck_at,
      last_sample_batch_id,
      last_batch_id,
      published_batch_id,
      published_at,
    },
  };
}

export function validateRecommendationBatchInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<RecommendationBatchRecord, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const batch_id = String(body.batch_id ?? "").trim();
  const batch_type = String(body.batch_type ?? "").trim() as RecommendationBatchRecord["batch_type"];
  const trigger_source = String(
    body.trigger_source ?? "",
  ).trim() as RecommendationBatchRecord["trigger_source"];
  const session_id = String(body.session_id ?? "").trim() || undefined;
  const job_id = String(body.job_id ?? "").trim() || undefined;
  const customer_id = String(body.customer_id ?? "").trim() || undefined;
  const sceneRaw = String(body.scene ?? "").trim();
  const scene =
    sceneRaw.length > 0
      ? (sceneRaw as RecommendationBatchRecord["scene"])
      : undefined;
  const trace_id = String(body.trace_id ?? "").trim() || undefined;
  const related_run_ids = toCanonicalStringList(
    body.related_run_ids,
    fieldErrors,
    "related_run_ids",
  );
  const config_snapshot_id = String(body.config_snapshot_id ?? "").trim();
  const started_at = String(body.started_at ?? "").trim();
  const finished_at = String(body.finished_at ?? "").trim() || undefined;
  const status = String(body.status ?? "").trim() as RecommendationBatchRecord["status"];
  const publication_status = String(
    body.publication_status ?? "unpublished",
  ).trim() as RecommendationBatchRecord["publication_status"];
  const error_summary = String(body.error_summary ?? "").trim() || undefined;
  const fallback_used = parseBoolean(body.fallback_used);

  if (mode === "create" && !isNonEmptyString(batch_id)) {
    fieldErrors.batch_id = "batch_id 不能为空";
  }
  if (
    ![
      "scheduled_generation",
      "sample_generation",
      "frontstage_realtime",
      "manual_replay",
    ].includes(batch_type)
  ) {
    fieldErrors.batch_type = "batch_type 不合法";
  }
  if (!["system", "admin", "frontstage", "fallback"].includes(trigger_source)) {
    fieldErrors.trigger_source = "trigger_source 不合法";
  }
  if (scene && !isValidScene(scene)) {
    fieldErrors.scene = "scene 不合法";
  }
  if (!isNonEmptyString(config_snapshot_id)) {
    fieldErrors.config_snapshot_id = "config_snapshot_id 不能为空";
  }
  if (!isNonEmptyString(started_at)) {
    fieldErrors.started_at = "started_at 不能为空";
  }
  if (
    ![
      "queued",
      "running",
      "success",
      "partial_failed",
      "failed",
      "cancelled",
      "fallback_served",
    ].includes(status)
  ) {
    fieldErrors.status = "status 不合法";
  }
  if (!["unpublished", "ready", "published"].includes(publication_status)) {
    fieldErrors.publication_status = "publication_status 不合法";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      batch_id,
      batch_type,
      trigger_source,
      session_id,
      job_id,
      customer_id,
      scene,
      trace_id,
      related_run_ids,
      config_snapshot_id,
      started_at,
      finished_at,
      status,
      publication_status,
      error_summary,
      fallback_used,
    },
  };
}

export function validateRecoverySnapshotInput(
  payload: unknown,
  mode: "create" | "update",
): ValidationResult<Omit<RecoverySnapshotRecord, "created_at" | "updated_at">> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const snapshot_id = String(body.snapshot_id ?? "").trim();
  const snapshot_name = String(body.snapshot_name ?? "").trim();
  const source = String(body.source ?? "manual").trim() as RecoverySnapshotRecord["source"];
  const description = String(body.description ?? "").trim();
  const config_snapshot_id = String(body.config_snapshot_id ?? "").trim();
  const related_entity_types = toCanonicalStringList(
    body.related_entity_types,
    fieldErrors,
    "related_entity_types",
  );
  const status = String(body.status ?? "available").trim() as RecoverySnapshotRecord["status"];
  const created_by = String(body.created_by ?? "admin").trim();
  const applied_at = String(body.applied_at ?? "").trim() || undefined;

  if (mode === "create" && !isNonEmptyString(snapshot_id)) {
    fieldErrors.snapshot_id = "snapshot_id 不能为空";
  }
  if (!isNonEmptyString(snapshot_name)) {
    fieldErrors.snapshot_name = "snapshot_name 不能为空";
  }
  if (!["seed", "manual", "system"].includes(source)) {
    fieldErrors.source = "source 不合法";
  }
  if (!isNonEmptyString(config_snapshot_id)) {
    fieldErrors.config_snapshot_id = "config_snapshot_id 不能为空";
  }
  if (!["available", "applied", "archived"].includes(status)) {
    fieldErrors.status = "status 不合法";
  }
  if (!isNonEmptyString(created_by)) {
    fieldErrors.created_by = "created_by 不能为空";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors };
  }

  return {
    valid: true,
    value: {
      snapshot_id,
      snapshot_name,
      source,
      description,
      config_snapshot_id,
      related_entity_types,
      status,
      created_by,
      applied_at,
    },
  };
}
