import type {
  CampaignEntity,
  DealerEntity,
  DealerSuggestionTemplateEntity,
  ProductEntity,
  PromptConfigEntity,
  RuleConfigEntity,
  TemplateReferenceItem,
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
  const weekly_focus_items = toStringList(body.weekly_focus_items);
  const promo_threshold = parseNumber(body.promo_threshold, 0);
  const promo_type = String(body.promo_type ?? "").trim();
  const activity_notes = toStringList(body.activity_notes);
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
      promo_threshold,
      promo_type,
      activity_notes,
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
