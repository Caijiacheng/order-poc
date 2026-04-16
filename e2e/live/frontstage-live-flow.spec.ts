import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

import { waitForLangfuseTrace } from "../helpers/langfuse";
import { getLiveSkipReason, hasRequiredLiveEnv } from "../helpers/live-env";

type ApiEnvelope<TData> = {
  success: boolean;
  data: TData;
  meta?: Record<string, unknown>;
};

type CartApiResponse = {
  items: Array<{ sku_id: string }>;
};

type RecommendationsResponse = {
  dailyRecommendations: Array<{ recommendation_item_id?: string; sku_id: string }>;
  weeklyFocusRecommendations: Array<{ recommendation_item_id?: string; sku_id: string }>;
  summary: {
    trace_id?: string;
    daily_run_id: string;
    weekly_run_id: string;
  };
};

type ExplainResponse = {
  title: string;
  content: string;
  summary: {
    trace_id?: string;
  };
};

type CartOptimizeResponse = {
  thresholdSuggestion: {
    recommendation_item_id?: string;
    sku_id: string;
    suggested_qty: number;
  } | null;
  boxAdjustments: Array<{
    recommendation_item_id?: string;
    sku_id: string;
    from_qty: number;
    to_qty: number;
  }>;
  pairSuggestions: Array<{
    recommendation_item_id?: string;
    sku_id: string;
    suggested_qty: number;
  }>;
  summary: {
    trace_id?: string;
    recommendation_run_id: string;
  };
};

type SubmitCartResponse = {
  order: {
    order_id: string;
    submitted_at: string;
    total_amount: number;
    item_count: number;
  };
  summary?: {
    trace_id?: string;
  };
};

type RecommendationRunDetailResponse = {
  run: {
    recommendation_run_id: string;
    customer_id: string;
    page_name: string;
    model_name: string;
    prompt_snapshot: string;
    status: string;
    trace_id?: string;
  };
  items: Array<{
    recommendation_item_id: string;
    sku_id: string;
    was_explained: boolean;
    was_applied: boolean;
    final_status: string;
  }>;
};

async function expectEnvelope<TData>(response: APIResponse | Response) {
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as ApiEnvelope<TData>;
  expect(payload.success).toBe(true);
  return payload;
}

async function clearCart(page: Page) {
  const cartResponse = await page.request.get("/api/cart");
  const cartPayload = await expectEnvelope<CartApiResponse>(cartResponse);

  for (const item of cartPayload.data.items) {
    const deleteResponse = await page.request.delete(`/api/cart/items/${item.sku_id}`);
    expect(deleteResponse.ok()).toBe(true);
  }
}

async function fetchRecommendationRunDetail(page: Page, runId: string) {
  const detailResponse = await page.request.get(`/api/admin/reports/recommendations/${runId}`);
  const detailPayload =
    await expectEnvelope<RecommendationRunDetailResponse>(detailResponse);
  return detailPayload.data;
}

function getTraceId(payloadMeta: Record<string, unknown> | undefined, dataTraceId?: string) {
  const metaTraceId = typeof payloadMeta?.trace_id === "string" ? payloadMeta.trace_id : "";
  return metaTraceId || dataTraceId || "";
}

test.describe.configure({ mode: "serial" });

test("live procurement flow records real recommendation and explanation traces", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const skipReason = getLiveSkipReason();
  test.skip(!hasRequiredLiveEnv(), skipReason);
  expect(process.env.LLM_MOCK_MODE).not.toBe("true");

  await clearCart(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/procurement$/);
  await expect(page.getByTestId("procurement-home")).toBeVisible();
  await expect(page.getByTestId("replenishment-module")).toBeVisible();
  await expect(page.getByTestId("campaign-module")).toBeVisible();

  const recommendationsResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/recommendations"),
  );
  await page.getByRole("button", { name: "刷新采购建议" }).click();
  const recommendationsPayload = await expectEnvelope<RecommendationsResponse>(
    await recommendationsResponsePromise,
  );

  const recommendationTraceId = recommendationsPayload.data.summary.trace_id ?? "";
  const dailyRunId = recommendationsPayload.data.summary.daily_run_id;
  const weeklyRunId = recommendationsPayload.data.summary.weekly_run_id;

  expect(dailyRunId).toMatch(/^reco_run_/);
  expect(weeklyRunId).toMatch(/^reco_run_/);
  expect(recommendationTraceId).toMatch(/^[a-f0-9]{32}$/);
  expect(recommendationsPayload.data.dailyRecommendations.length).toBeGreaterThan(0);
  expect(recommendationsPayload.data.weeklyFocusRecommendations.length).toBeGreaterThan(0);

  await expect(page.getByText("采购建议已刷新，可直接查看原因并加入采购清单。")).toBeVisible({
    timeout: 90_000,
  });

  const explainResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/explain"),
  );
  await page
    .getByTestId("replenishment-module")
    .getByRole("button", { name: "查看原因" })
    .first()
    .click();
  const explainPayload = await expectEnvelope<ExplainResponse>(await explainResponsePromise);

  const explainTraceId = explainPayload.data.summary.trace_id ?? "";
  expect(explainTraceId).toMatch(/^[a-f0-9]{32}$/);
  expect(explainPayload.data.title).not.toEqual("");
  expect(explainPayload.data.content).not.toEqual("");
  await expect(page.locator("body")).toContainText(explainPayload.data.title, {
    timeout: 90_000,
  });

  const dailyDetail = await fetchRecommendationRunDetail(page, dailyRunId);
  expect(dailyDetail.run.page_name).toBe("/procurement");
  expect(dailyDetail.run.model_name).toBe(process.env.LLM_MODEL);
  expect(dailyDetail.run.prompt_snapshot).not.toEqual("");
  expect(dailyDetail.items.some((item) => item.was_explained)).toBe(true);

  const recommendationTrace = await waitForLangfuseTrace({
    baseUrl: process.env.LANGFUSE_BASE_URL as string,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
    secretKey: process.env.LANGFUSE_SECRET_KEY as string,
    traceId: recommendationTraceId,
    expectedName: "homepage.generate-recommendations",
  });
  const explainTrace = await waitForLangfuseTrace({
    baseUrl: process.env.LANGFUSE_BASE_URL as string,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
    secretKey: process.env.LANGFUSE_SECRET_KEY as string,
    traceId: explainTraceId,
    expectedName: "recommendation.explain",
  });

  expect(recommendationTrace.name).toBe("homepage.generate-recommendations");
  expect(explainTrace.name).toBe("recommendation.explain");
});

test("live basket optimization and checkout flow keep report and Langfuse traces aligned", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const skipReason = getLiveSkipReason();
  test.skip(!hasRequiredLiveEnv(), skipReason);
  expect(process.env.LLM_MOCK_MODE).not.toBe("true");

  await clearCart(page);

  const seedResponse = await page.request.post("/api/cart/items", {
    data: {
      customerId: "dealer_cd_pf",
      sku_id: "cb_oyster_big_2270",
      qty: 3,
      source: "manual",
    },
  });
  expect(seedResponse.ok()).toBe(true);

  await page.goto("/basket");
  await expect(page).toHaveURL(/\/basket$/);
  await expect(page.getByTestId("basket-summary")).toBeVisible();
  await expect(page.getByTestId("basket-optimization-panel")).toBeVisible();

  const optimizeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart-optimize"),
  );
  await page.getByRole("button", { name: "生成优化建议" }).click();
  const optimizePayload = await expectEnvelope<CartOptimizeResponse>(
    await optimizeResponsePromise,
  );

  const optimizationTraceId = optimizePayload.data.summary.trace_id ?? "";
  const optimizationRunId = optimizePayload.data.summary.recommendation_run_id;

  expect(optimizationRunId).toMatch(/^reco_run_/);
  expect(optimizationTraceId).toMatch(/^[a-f0-9]{32}$/);
  expect(optimizePayload.data.thresholdSuggestion).not.toBeNull();
  expect(optimizePayload.data.boxAdjustments.length).toBeGreaterThan(0);
  expect(optimizePayload.data.pairSuggestions.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "一键应用全部" }).click();
  await expect(page.getByText("已批量应用本次订单优化建议。")).toBeVisible({
    timeout: 90_000,
  });

  await page.getByRole("link", { name: "去下单确认" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("checkout-summary")).toBeVisible();

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart/submit"),
  );
  await page.getByRole("button", { name: "确认提交订单" }).click();
  const submitPayload = await expectEnvelope<SubmitCartResponse>(await submitResponsePromise);

  const submitTraceId = getTraceId(
    submitPayload.meta,
    submitPayload.data.summary?.trace_id,
  );
  expect(submitTraceId).toMatch(/^[a-f0-9]{32}$/);
  expect(submitPayload.data.order.order_id).toMatch(/^order_/);
  await expect(page.getByText("订单提交成功。")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(submitPayload.data.order.order_id)).toBeVisible({
    timeout: 90_000,
  });

  const optimizationDetail = await fetchRecommendationRunDetail(page, optimizationRunId);
  expect(optimizationDetail.run.page_name).toBe("/basket");
  expect(optimizationDetail.items.some((item) => item.was_applied)).toBe(true);
  expect(
    optimizationDetail.items.some((item) => item.final_status === "submitted_with_order"),
  ).toBe(true);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/workbench\/overview$/);
  await page.getByRole("link", { name: "数据与分析" }).click();
  await page.getByTestId("admin-secondary-nav").getByRole("link", { name: "推荐记录" }).click();
  await expect(page).toHaveURL(/\/admin\/analytics\/recommendations$/);
  await expect(page.getByTestId("recommendation-report-table")).toBeVisible();

  const optimizationRow = page.locator("tr", { hasText: optimizationRunId }).first();
  await expect(optimizationRow).toBeVisible({ timeout: 90_000 });
  await optimizationRow.click();
  await expect(page.getByTestId("trace-link")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("link", { name: "前往链路观察" }).click();
  await expect(page).toHaveURL(/\/admin\/observability\/traces$/);
  const traceRow = page.locator("tr", { hasText: optimizationTraceId }).first();
  await expect(traceRow).toBeVisible({ timeout: 90_000 });
  await traceRow.click();
  await expect(page.getByTestId("trace-link")).toBeVisible({ timeout: 90_000 });

  const optimizationTrace = await waitForLangfuseTrace({
    baseUrl: process.env.LANGFUSE_BASE_URL as string,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
    secretKey: process.env.LANGFUSE_SECRET_KEY as string,
    traceId: optimizationTraceId,
    expectedName: "cart.generate-optimization",
  });
  const submitTrace = await waitForLangfuseTrace({
    baseUrl: process.env.LANGFUSE_BASE_URL as string,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
    secretKey: process.env.LANGFUSE_SECRET_KEY as string,
    traceId: submitTraceId,
    expectedName: "confirm.submit-order",
  });

  expect(optimizationTrace.name).toBe("cart.generate-optimization");
  expect(submitTrace.name).toBe("confirm.submit-order");
});
