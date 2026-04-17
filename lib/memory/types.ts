export type EntityStatus = "active" | "inactive";

export type SuggestionScene =
  | "daily_recommendation"
  | "weekly_focus"
  | "threshold_topup"
  | "box_pair_optimization";

export type RecommendationStrategyScene =
  | "hot_sale_bundle"
  | "replenishment_bundle"
  | "campaign_bundle";

export type FrontstageCanonicalPageName = "/purchase" | "/order-submit";

export type FrontstagePageName = FrontstageCanonicalPageName;

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

export type BundleTemplateType =
  | "hot_sale_restock"
  | "stockout_restock"
  | "campaign_stockup";

export type BundleTemplateItem = {
  recommendation_item_id?: string;
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  reason: string;
  reason_tags: string[];
  priority: number;
  action_type?: "add_to_cart" | "adjust_qty" | "replace_item";
  unit_price: number;
  line_amount: number;
};

export type BundleTemplate = {
  template_id: string;
  template_type: BundleTemplateType;
  template_name: "热销补货" | "缺货补货" | "活动备货";
  template_subtitle: string;
  source: "published_recommendation" | "fallback_catalog";
  estimated_amount: number;
  items: BundleTemplateItem[];
};

export type ActivityHighlight = {
  activity_id: string;
  activity_name: string;
  week_id: string;
  promo_type: string;
  promo_threshold: number;
  activity_notes: string[];
  sku_ids: string[];
  estimated_amount: number;
  items: BundleTemplateItem[];
};

export type DealerSegmentEntity = {
  segment_id: string;
  segment_name: string;
  description: string;
  city_list: string[];
  customer_types: string[];
  channel_types: string[];
  dealer_ids: string[];
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type ProductPoolType =
  | "regular"
  | "hot_sale"
  | "new_product"
  | "campaign"
  | "pairing";

export type ProductPoolEntity = {
  pool_id: string;
  pool_name: string;
  pool_type: ProductPoolType;
  description: string;
  sku_ids: string[];
  pair_sku_ids: string[];
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type RecommendationStrategyEntity = {
  strategy_id: string;
  strategy_name: string;
  scene: RecommendationStrategyScene;
  target_dealer_ids: string[];
  dealer_segment_ids: string[];
  product_pool_ids: string[];
  campaign_ids: string[];
  candidate_sku_ids: string[];
  reference_items: TemplateReferenceItem[];
  business_notes: string;
  expression_template_id: string;
  priority: number;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type ExpressionTemplateType =
  | "bundle_explanation"
  | "topup_explanation";

export type ExpressionTemplateScene = "all" | "bundle" | "topup";

export type ExpressionTemplateEntity = {
  expression_template_id: string;
  expression_template_name: string;
  template_type: ExpressionTemplateType;
  scene: ExpressionTemplateScene;
  tone: string;
  avoid: string[];
  reason_limit: number;
  system_role: string;
  instruction: string;
  style_hint: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type GlobalRuleEntity = {
  global_rule_id: string;
  rule_version: string;
  replenishment_days_threshold: number;
  cart_gap_trigger_amount: number;
  threshold_amount: number;
  prefer_frequent_items: boolean;
  prefer_pair_items: boolean;
  box_adjust_if_close: boolean;
  box_adjust_distance_limit: number;
  allow_new_product_recommendation: boolean;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type GenerationJobStatus =
  | "draft"
  | "prechecking"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PublicationStatus = "unpublished" | "ready" | "published";

export type GenerationJobEntity = {
  job_id: string;
  job_name: string;
  business_date: string;
  target_dealer_ids: string[];
  target_segment_ids: string[];
  strategy_ids: string[];
  publish_mode: "manual" | "auto";
  status: GenerationJobStatus;
  publication_status: PublicationStatus;
  precheck_summary: string;
  last_precheck_at?: string;
  last_sample_batch_id?: string;
  last_batch_id?: string;
  published_batch_id?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
};

export type RecommendationBatchStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_failed"
  | "failed"
  | "cancelled"
  | "fallback_served";

export type RecommendationBatchRecord = {
  batch_id: string;
  batch_type:
    | "scheduled_generation"
    | "sample_generation"
    | "frontstage_realtime"
    | "manual_replay";
  trigger_source: "system" | "admin" | "frontstage" | "fallback";
  session_id?: string;
  job_id?: string;
  customer_id?: string;
  scene?: SuggestionScene;
  trace_id?: string;
  related_run_ids: string[];
  config_snapshot_id: string;
  started_at: string;
  finished_at?: string;
  status: RecommendationBatchStatus;
  publication_status: PublicationStatus;
  error_summary?: string;
  fallback_used: boolean;
  created_at: string;
  updated_at: string;
};

export type RecoverySnapshotStatus = "available" | "applied" | "archived";

export type RecoverySnapshotRecord = {
  snapshot_id: string;
  snapshot_name: string;
  source: "seed" | "manual" | "system";
  description: string;
  config_snapshot_id: string;
  related_entity_types: string[];
  status: RecoverySnapshotStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  applied_at?: string;
};

export type CampaignEntity = {
  campaign_id: string;
  week_id: string;
  campaign_name: string;
  weekly_focus_items: string[];
  product_pool_ids?: string[];
  promo_threshold: number;
  promo_type: string;
  activity_notes: string[];
  target_dealer_ids?: string[];
  target_segment_ids?: string[];
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
    | "generation_job_created"
    | "recommendation_batch_created"
    | "recovery_snapshot_applied"
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
  batch_id?: string;
  trace_id?: string;
  function_id?: string;
  telemetry_metadata?: Record<string, unknown>;
  customer_id: string;
  customer_name: string;
  scene: SuggestionScene;
  page_name: FrontstagePageName;
  trigger_source: "auto" | "manual" | "assistant";
  strategy_id?: string;
  expression_template_id?: string;
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

export type PublishedSuggestionsCartSummary = {
  source: "customer_cart" | "template_projection";
  sku_count: number;
  item_count: number;
  total_amount: number;
  threshold_amount: number;
  gap_to_threshold: number;
  threshold_reached: boolean;
};

export type CartOptimizationBarType = "threshold" | "box_adjustment" | "pairing";

export type CartOptimizationBarItem = {
  recommendation_item_id?: string;
  sku_id: string;
  sku_name: string;
  action_type: "add_to_cart" | "adjust_qty";
  suggested_qty: number;
  from_qty?: number;
  to_qty?: number;
};

export type CartOptimizationRecommendationBar = {
  bar_id: string;
  bar_type: CartOptimizationBarType;
  headline: string;
  value_message: string;
  action_label: string;
  combo_id: string;
  items: CartOptimizationBarItem[];
  explanation: string;
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
    | "dealer_segment"
    | "product_pool"
    | "recommendation_strategy"
    | "expression_template"
    | "campaign"
    | "global_rule"
    | "generation_job"
    | "recommendation_batch"
    | "recovery_snapshot";
  entity_id: string;
  action: "create" | "update" | "delete" | "toggle" | "apply";
  summary: string;
};

export type AppMemoryStore = {
  products: ProductEntity[];
  dealers: DealerEntity[];
  dealerSegments: DealerSegmentEntity[];
  productPools: ProductPoolEntity[];
  recommendationStrategies: RecommendationStrategyEntity[];
  expressionTemplates: ExpressionTemplateEntity[];
  campaigns: CampaignEntity[];
  globalRules: GlobalRuleEntity;
  generationJobs: GenerationJobEntity[];
  recommendationBatches: RecommendationBatchRecord[];
  recoverySnapshots: RecoverySnapshotRecord[];
  uiConfig: UIConfigEntity;
  metrics: MetricsStore;
  recommendationRuns: RecommendationRunRecord[];
  recommendationItems: RecommendationItemRecord[];
  cartSessions: Record<string, CartSession>;
  auditLogs: AuditLogEvent[];
  rules: RuleConfigEntity;
  promptConfig: PromptConfigEntity;
};
