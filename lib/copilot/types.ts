export type CopilotTraceName = "copilot.autofill-order" | "copilot.explain-order";

export type CopilotPageName = "/purchase" | "/order-submit";

export type CopilotRunType = "autofill_order" | "explain_order";

export type CopilotRunStatus = "running" | "succeeded" | "blocked" | "failed";

export type CopilotJobStatus =
  | "running"
  | "preview_ready"
  | "blocked"
  | "applied"
  | "failed";

export type CopilotStepName =
  | "load_context"
  | "parse_intent"
  | "detect_campaign_state"
  | "build_legal_candidates"
  | "select_best_combo"
  | "apply_draft"
  | "run_cart_optimization"
  | "summarize_result";

export type CopilotStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type CopilotIntentType =
  | "start_order"
  | "topup_campaign"
  | "explain_order"
  | "adjust_order"
  | "mixed";

export type CopilotRiskMode = "conservative" | "balanced" | "aggressive";

export type CopilotIntent = {
  intent_type: CopilotIntentType;
  budget_target: number | null;
  prefer_campaign: boolean | null;
  prefer_frequent_items: boolean | null;
  avoid_new_products: boolean | null;
  risk_mode: CopilotRiskMode | null;
  must_have_keywords: string[];
  exclude_keywords: string[];
};

export type CopilotCampaignState = {
  campaign_id: string | null;
  campaign_name: string | null;
  promo_threshold: number;
  current_amount: number;
  gap_amount: number;
  is_hit: boolean;
};

export type CopilotDraftItem = {
  sku_id: string;
  sku_name: string;
  action_type: "add_to_cart" | "adjust_qty";
  suggested_qty: number;
  from_qty?: number;
  reason: string;
  line_amount: number;
};

export type CopilotLegalCombo = {
  combo_id: string;
  combo_type: "replenishment" | "campaign_topup" | "mixed";
  deterministic_score: number;
  estimated_additional_amount: number;
  projected_cart_total: number;
  projected_campaign_gap: number;
  items: CopilotDraftItem[];
  rationale: string[];
};

export type CopilotDraftStatus = "preview" | "applied" | "blocked" | "expired";

export type CopilotDraft = {
  draft_id: string;
  run_id: string;
  job_id: string;
  trace_id?: string;
  session_id: string;
  customer_id: string;
  status: CopilotDraftStatus;
  selected_combo_id?: string;
  selected_explanation?: string;
  blocked_reason?: string;
  items: CopilotDraftItem[];
  campaign_state: CopilotCampaignState;
  cart_amount_before: number;
  cart_amount_after_preview: number;
  should_go_checkout: boolean;
  summary_text: string;
  created_at: string;
  updated_at: string;
};

export type CopilotRun = {
  run_id: string;
  run_type: CopilotRunType;
  top_level_trace_name: CopilotTraceName;
  trace_id?: string;
  session_id: string;
  customer_id: string;
  page_name: CopilotPageName;
  user_message: string;
  status: CopilotRunStatus;
  intent?: CopilotIntent;
  job_id?: string;
  selected_combo_id?: string;
  campaign_hit?: boolean;
  campaign_gap_amount?: number;
  cart_write_succeeded: boolean;
  reached_checkout: boolean;
  order_submitted: boolean;
  model_name?: string;
  model_latency_ms?: number;
  blocked_reason?: string;
  total_latency_ms?: number;
  created_at: string;
  updated_at: string;
  finished_at?: string;
};

export type CopilotJob = {
  job_id: string;
  run_id: string;
  draft_id?: string;
  trace_id?: string;
  status: CopilotJobStatus;
  started_at: string;
  finished_at?: string;
  updated_at: string;
  blocked_reason?: string;
};

export type CopilotStep = {
  step_id: string;
  run_id: string;
  job_id?: string;
  trace_id?: string;
  step_name: CopilotStepName;
  step_order: number;
  status: CopilotStepStatus;
  started_at: string;
  finished_at?: string;
  latency_ms?: number;
  error_message?: string;
  payload?: Record<string, unknown>;
};

export type CopilotMetricEventType =
  | "copilot_usage"
  | "copilot_autofill_started"
  | "copilot_preview_succeeded"
  | "copilot_apply_attempted"
  | "copilot_apply_succeeded"
  | "copilot_campaign_topup_attempted"
  | "copilot_campaign_topup_succeeded"
  | "copilot_checkout_converted"
  | "copilot_run_completed";

export type CopilotMetricEvent = {
  id: string;
  timestamp: string;
  run_id?: string;
  job_id?: string;
  customer_id?: string;
  event_type: CopilotMetricEventType;
  latency_ms?: number;
  payload?: Record<string, unknown>;
};

export type CopilotMetricsStore = {
  copilot_usage_count: number;
  copilot_autofill_start_count: number;
  copilot_preview_success_rate: number;
  copilot_apply_to_cart_success_rate: number;
  copilot_campaign_topup_success_rate: number;
  copilot_checkout_conversion_rate: number;
  copilot_avg_latency_ms: number;
};
