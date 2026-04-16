export type EntityStatus = "active" | "inactive";

export type SuggestionScene =
  | "daily_recommendation"
  | "weekly_focus"
  | "threshold_topup"
  | "box_pair_optimization";

export type ProductEntity = {
  sku_id: string;
  sku_name: string;
  brand: string;
  category: string;
  spec: string;
  price_per_case: number;
  box_multiple: number;
  tags: string[];
  pair_items: string[];
  is_weekly_focus: boolean;
  is_new_product: boolean;
  status: EntityStatus;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type DealerEntity = {
  customer_id: string;
  customer_name: string;
  city: string;
  customer_type: string;
  channel_type: string;
  store_count_hint: string;
  last_order_days_ago: number;
  order_frequency: string;
  price_sensitivity: "高" | "中" | "中低" | "低";
  new_product_acceptance: "高" | "中" | "低";
  frequent_items: string[];
  forbidden_items: string[];
  preferred_categories: string[];
  business_traits: string[];
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type TemplateReferenceItem = {
  sku_id: string;
  qty: number;
  reason: string;
  reason_tags: string[];
  sort_order: number;
};

export type DealerSuggestionTemplateEntity = {
  template_id: string;
  customer_id: string;
  template_name: string;
  scene: SuggestionScene;
  reference_items: TemplateReferenceItem[];
  business_notes: string;
  style_hint: string;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CampaignEntity = {
  campaign_id: string;
  week_id: string;
  campaign_name: string;
  weekly_focus_items: string[];
  promo_threshold: number;
  promo_type: string;
  activity_notes: string[];
  target_customer_types: string[];
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type RuleConfigEntity = {
  replenishment_days_threshold: number;
  cart_gap_trigger_amount: number;
  threshold_amount: number;
  prefer_frequent_items: boolean;
  prefer_pair_items: boolean;
  box_adjust_if_close: boolean;
  box_adjust_distance_limit: number;
  allow_new_product_recommendation: boolean;
};

export type PromptConfigEntity = {
  global_style: {
    tone: string;
    avoid: string[];
    reason_limit: number;
  };
  recommendation_prompt: {
    system_role: string;
    instruction: string;
  };
  cart_opt_prompt: {
    system_role: string;
    instruction: string;
  };
  explain_prompt: {
    system_role: string;
    instruction: string;
  };
};

export type UIConfigEntity = {
  product_title: string;
  homepage_banner: string;
  recommendation_section_title: string;
  weekly_focus_title: string;
  cart_panel_title: string;
  confirm_summary_title: string;
};

export type MetricEvent = {
  id: string;
  timestamp: string;
  customerId: string;
  customerName: string;
  eventType:
    | "recommendation_generated"
    | "weekly_focus_generated"
    | "recommendation_applied"
    | "cart_optimized"
    | "threshold_reached"
    | "box_adjusted"
    | "pair_item_added"
    | "explanation_viewed"
    | "config_updated";
  scene: SuggestionScene | "admin_config";
  payload: Record<string, unknown>;
};

export type MetricsStore = {
  sessionCount: number;
  recommendationRequests: number;
  weeklyFocusRequests: number;
  cartOptimizationRequests: number;
  explanationRequests: number;
  addToCartFromSuggestion: number;
  applyOptimizationCount: number;
  thresholdReachedCount: number;
  boxAdjustmentCount: number;
  pairSuggestionAppliedCount: number;
  totalCartAmountBefore: number;
  totalCartAmountAfter: number;
  totalRevenueLift: number;
  averageModelLatencyMs: number;
  totalModelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  structuredOutputFailureCount: number;
  customerSceneBreakdown: Record<string, number>;
  latestEvents: MetricEvent[];
};

export type RecommendationRunRecord = {
  recommendation_run_id: string;
  session_id: string;
  trace_id?: string;
  function_id?: string;
  telemetry_metadata?: Record<string, unknown>;
  customer_id: string;
  customer_name: string;
  scene: SuggestionScene;
  page_name: "/procurement" | "/catalog" | "/basket";
  trigger_source: "auto" | "manual" | "assistant";
  template_id?: string;
  template_name?: string;
  prompt_version?: string;
  prompt_snapshot: string;
  candidate_sku_ids: string[];
  returned_sku_ids: string[];
  cart_amount_before?: number;
  cart_amount_after?: number;
  model_name: string;
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  status: "generated" | "partially_applied" | "fully_applied" | "ignored";
  created_at: string;
  updated_at: string;
};

export type RecommendationItemRecord = {
  recommendation_item_id: string;
  recommendation_run_id: string;
  customer_id: string;
  scene: SuggestionScene;
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
  was_viewed: boolean;
  was_explained: boolean;
  was_applied: boolean;
  applied_qty?: number;
  applied_at?: string;
  applied_by: "user" | "system" | "unknown";
  ignored_at?: string;
  rejected_reason?: string;
  order_submitted_with_item?: boolean;
  final_status:
    | "pending"
    | "viewed"
    | "explained"
    | "applied"
    | "ignored"
    | "rejected"
    | "submitted_with_order"
    | "expired";
  created_at: string;
  updated_at: string;
};

export type CartItem = {
  sku_id: string;
  sku_name: string;
  qty: number;
  price_per_case: number;
  box_multiple: number;
  source: "manual" | "recommendation";
  recommendation_item_id?: string;
  added_at: string;
  updated_at: string;
};

export type CartSummary = {
  item_count: number;
  sku_count: number;
  total_amount: number;
  threshold_amount: number;
  gap_to_threshold: number;
  threshold_reached: boolean;
};

export type CartSession = {
  session_id: string;
  customer_id?: string;
  items: CartItem[];
  summary: CartSummary;
  submitted_orders: Array<{
    order_id: string;
    submitted_at: string;
    total_amount: number;
    item_count: number;
  }>;
  created_at: string;
  updated_at: string;
};

export type AuditLogEvent = {
  id: string;
  timestamp: string;
  entity_type:
    | "product"
    | "dealer"
    | "suggestion_template"
    | "campaign"
    | "rule"
    | "prompt";
  entity_id: string;
  action: "create" | "update" | "delete" | "toggle";
  summary: string;
};

export type AppMemoryStore = {
  products: ProductEntity[];
  dealers: DealerEntity[];
  suggestionTemplates: DealerSuggestionTemplateEntity[];
  campaigns: CampaignEntity[];
  rules: RuleConfigEntity;
  promptConfig: PromptConfigEntity;
  uiConfig: UIConfigEntity;
  metrics: MetricsStore;
  recommendationRuns: RecommendationRunRecord[];
  recommendationItems: RecommendationItemRecord[];
  cartSessions: Record<string, CartSession>;
  auditLogs: AuditLogEvent[];
};
