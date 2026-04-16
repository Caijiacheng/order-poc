"use client";

import { requestJson, requestJsonWithMeta } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type {
  AuditLogEvent,
  CartSession,
  DealerEntity,
  MetricEvent,
  ProductEntity,
  RecommendationItemRecord,
  RecommendationRunRecord,
  SuggestionScene,
} from "@/lib/memory/types";

export type RecommendationCardItem = {
  recommendation_item_id?: string;
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  reason: string;
  reason_tags: string[];
  priority: number;
  action_type: "add_to_cart" | "adjust_qty" | "replace_item";
};

export type RecommendationsResponse = {
  dailyRecommendations: RecommendationCardItem[];
  weeklyFocusRecommendations: RecommendationCardItem[];
  summary: {
    trace_id?: string;
    daily_run_id: string;
    weekly_run_id: string;
  };
};

export type ExplainResponse = {
  title: string;
  content: string;
  explanations: Array<{ sku_id: string; explanation: string }>;
  summary: {
    trace_id?: string;
    scene: SuggestionScene;
    count: number;
  };
};

export type OptimizationThresholdSuggestion = {
  recommendation_item_id?: string;
  sku_id: string;
  suggested_qty: number;
  reason: string;
  effect: string;
};

export type OptimizationBoxAdjustment = {
  recommendation_item_id?: string;
  sku_id: string;
  from_qty: number;
  to_qty: number;
  reason: string;
};

export type OptimizationPairSuggestion = {
  recommendation_item_id?: string;
  sku_id: string;
  suggested_qty: number;
  reason: string;
};

export type CartOptimizationResponse = {
  thresholdSuggestion: OptimizationThresholdSuggestion | null;
  boxAdjustments: OptimizationBoxAdjustment[];
  pairSuggestions: OptimizationPairSuggestion[];
  summary: {
    trace_id?: string;
    recommendation_run_id: string;
    cart: CartSession["summary"];
  };
};

export type AddCartItemResponse = {
  cart: CartSession;
  before_amount: number;
  after_amount: number;
  no_op?: boolean;
};

export type PatchCartItemResponse = {
  cart: CartSession;
  before_amount: number;
  after_amount: number;
};

export type SubmitCartResponse = {
  order: {
    order_id: string;
    submitted_at: string;
    total_amount: number;
    item_count: number;
  };
  cart: CartSession;
};

export type ReportsSummaryResponse = {
  entities: {
    products: { total: number; active: number };
    dealers: { total: number; active: number };
    suggestionTemplates: { total: number; active: number };
    campaigns: { total: number; active: number };
  };
  metrics: {
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
  recommendationRuns: {
    total: number;
    generated: number;
    partiallyApplied: number;
    fullyApplied: number;
    ignored: number;
  };
};

export type RecommendationRunDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

export type LangfuseMeta = {
  langfuseBaseUrl: string;
};

function getMetaString(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  return typeof value === "string" ? value : "";
}

function normalizeLangfuseMeta(meta: Record<string, unknown>): LangfuseMeta {
  const envBase = process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL ?? "";
  return {
    langfuseBaseUrl: getMetaString(meta, "langfuse_base_url") || envBase,
  };
}

export function buildLangfuseTraceUrl(traceId?: string, baseUrl?: string) {
  if (!traceId || !baseUrl) {
    return "";
  }
  try {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/trace/${traceId}`;
    return url.toString();
  } catch {
    return "";
  }
}

export function formatMoney(amount: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function fetchActiveDealers() {
  const result = await requestJson<ListResult<DealerEntity>>(
    "/api/admin/dealers?page=1&pageSize=100&status=active&sortBy=customer_name&sortOrder=asc",
  );
  return result.items;
}

export async function fetchActiveProducts() {
  const result = await requestJson<ListResult<ProductEntity>>(
    "/api/admin/products?page=1&pageSize=100&status=active&sortBy=display_order&sortOrder=asc",
  );
  return result.items;
}

export async function fetchCart() {
  return requestJson<CartSession>("/api/cart");
}

export async function createRecommendations(input: {
  customerId: string;
  triggerSource?: "auto" | "manual" | "assistant";
  pageName?: "/procurement" | "/catalog" | "/basket";
}) {
  const result = await requestJsonWithMeta<RecommendationsResponse>("/api/recommendations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function requestExplain(input: {
  customerId: string;
  scene: SuggestionScene;
  targetItemIds: string[];
}) {
  const result = await requestJsonWithMeta<ExplainResponse>("/api/explain", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function addCartItem(input: {
  customerId?: string;
  sku_id?: string;
  qty?: number;
  source?: "manual" | "recommendation";
  recommendation_item_id?: string;
  lifecycle_action?: "apply" | "ignore" | "reject";
  rejected_reason?: string;
}) {
  return requestJson<AddCartItemResponse>("/api/cart/items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function patchCartItem(input: {
  skuId: string;
  qty: number;
  recommendation_item_id?: string;
}) {
  return requestJson<PatchCartItemResponse>(`/api/cart/items/${input.skuId}`, {
    method: "PATCH",
    body: JSON.stringify({
      qty: input.qty,
      recommendation_item_id: input.recommendation_item_id,
    }),
  });
}

export async function removeCartItem(skuId: string) {
  return requestJson<PatchCartItemResponse>(`/api/cart/items/${skuId}`, {
    method: "DELETE",
  });
}

export async function optimizeCart(customerId?: string) {
  const result = await requestJsonWithMeta<CartOptimizationResponse>("/api/cart-optimize", {
    method: "POST",
    body: JSON.stringify(customerId ? { customerId } : {}),
  });
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function submitCart() {
  return requestJson<SubmitCartResponse>("/api/cart/submit", {
    method: "POST",
  });
}

export async function fetchReportsSummary() {
  return requestJson<ReportsSummaryResponse>("/api/admin/reports/summary");
}

export async function fetchReportEvents(query: URLSearchParams) {
  return requestJson<ListResult<MetricEvent>>(`/api/admin/reports/events?${query.toString()}`);
}

export async function fetchAuditLogs(query: URLSearchParams) {
  return requestJson<ListResult<AuditLogEvent>>(
    `/api/admin/reports/audit-logs?${query.toString()}`,
  );
}

export async function fetchRecommendationRuns(query: URLSearchParams) {
  const result = await requestJsonWithMeta<ListResult<RecommendationRunRecord>>(
    `/api/admin/reports/recommendations?${query.toString()}`,
  );
  return {
    list: result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function fetchRecommendationRunDetail(id: string) {
  const result = await requestJsonWithMeta<RecommendationRunDetail>(
    `/api/admin/reports/recommendations/${id}`,
  );
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}
