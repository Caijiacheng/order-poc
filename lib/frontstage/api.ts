"use client";

import { requestJson, requestJsonWithMeta } from "@/lib/admin/client";
import type { CopilotSummarizeResultOutput } from "@/lib/copilot/schemas";
import type { CopilotDraft, CopilotJob, CopilotRun, CopilotStep } from "@/lib/copilot/types";
import type { ListResult } from "@/lib/admin/types";
import type {
  ActivityHighlight,
  BundleTemplate,
  CartOptimizationRecommendationBar,
  CartSession,
  DealerEntity,
  FrontstagePageName,
  PublishedSuggestionsCartSummary,
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
  hotSaleRestockRecommendations: RecommendationCardItem[];
  stockoutRestockRecommendations: RecommendationCardItem[];
  campaignStockupRecommendations: RecommendationCardItem[];
  summary: {
    trace_id?: string;
    hot_sale_run_id: string;
    stockout_run_id: string;
    campaign_run_id: string;
  };
};

export type PublishedSuggestionsResponse = {
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

export type BundleRefineResponse = {
  trace_id?: string;
  summary: string;
  items: BundleTemplate["items"];
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

export type CartOptimizationResponse = {
  recommendationBars: CartOptimizationRecommendationBar[];
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

export type RecommendationRunDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

export type LangfuseMeta = {
  langfuseBaseUrl: string;
};

export type CopilotAutofillResponse = {
  run: CopilotRun;
  job: CopilotJob;
  draft: CopilotDraft;
  steps: CopilotStep[];
  summary: CopilotSummarizeResultOutput;
};

export type CopilotJobDetailResponse = {
  job: CopilotJob;
  run: CopilotRun | null;
  draft: CopilotDraft | null;
  steps: CopilotStep[];
};

export type CopilotApplyDraftResponse = {
  run: CopilotRun;
  job: CopilotJob;
  draft: CopilotDraft;
  steps: CopilotStep[];
  cart: CartSession;
  optimization: {
    recommendationBars: CartOptimizationRecommendationBar[];
    summary: {
      trace_id?: string;
      recommendation_run_id: string;
      cart: CartSession["summary"];
    };
  };
};

export type CopilotChatResponse = {
  run: CopilotRun;
  reply: string;
  summary: CopilotSummarizeResultOutput;
  steps: CopilotStep[];
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
  pageName?: FrontstagePageName;
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

export async function fetchPublishedSuggestions(customerId: string) {
  const result = await requestJsonWithMeta<PublishedSuggestionsResponse>(
    `/api/frontstage/published-suggestions?customerId=${encodeURIComponent(customerId)}`,
  );
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function refineBundleTemplate(input: {
  customerId: string;
  templateType: BundleTemplate["template_type"];
  currentItems: BundleTemplate["items"];
  userNeed: string;
}) {
  const result = await requestJsonWithMeta<BundleRefineResponse>(
    "/api/frontstage/bundle-refine",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
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

export async function fetchRecommendationRuns(query: URLSearchParams) {
  const result = await requestJsonWithMeta<ListResult<RecommendationRunRecord>>(
    `/api/admin/recommendation-records?${query.toString()}`,
  );
  return {
    list: result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function fetchRecommendationRunDetail(id: string) {
  const result = await requestJsonWithMeta<RecommendationRunDetail>(
    `/api/admin/recommendation-records/${id}`,
  );
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function requestCopilotAutofill(input: {
  customerId: string;
  message: string;
  pageName?: FrontstagePageName;
}) {
  const result = await requestJsonWithMeta<CopilotAutofillResponse>("/api/copilot/autofill", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function requestCopilotChat(input: {
  customerId: string;
  message: string;
  pageName?: FrontstagePageName;
}) {
  const result = await requestJsonWithMeta<CopilotChatResponse>("/api/copilot/chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function fetchCopilotJobDetail(jobId: string) {
  const result = await requestJsonWithMeta<CopilotJobDetailResponse>(
    `/api/copilot/jobs/${encodeURIComponent(jobId)}`,
  );
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}

export async function applyCopilotDraftToCart(input: {
  draftId: string;
  customerId?: string;
}) {
  const result = await requestJsonWithMeta<CopilotApplyDraftResponse>(
    `/api/copilot/drafts/${encodeURIComponent(input.draftId)}/apply`,
    {
      method: "POST",
      body: JSON.stringify({
        customerId: input.customerId,
      }),
    },
  );
  return {
    ...result.data,
    ...normalizeLangfuseMeta(result.meta),
  };
}
