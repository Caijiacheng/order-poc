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

type ListResult<TItem> = {
  items: TItem[];
  total: number;
};

type StrategySummary = {
  strategy_id: string;
  strategy_name: string;
  status: "active" | "inactive";
};

type GenerationJobSummary = {
  job_id: string;
  job_name: string;
};

type RecommendationBatchSummary = {
  batch_id: string;
  trace_id?: string;
};

type GenerationJobActionResponse = {
  job: {
    job_id: string;
    publication_status: "unpublished" | "ready" | "published";
    precheck_summary: string;
    published_batch_id?: string;
  };
  batch?: RecommendationBatchSummary;
  summary?: string;
  issues?: string[];
  sampled_customer_ids?: string[];
  generated_run_ids?: string[];
};

type DealerSummary = {
  customer_id: string;
  customer_name: string;
};

type PublishedSuggestionsResponse = {
  summary: {
    published: boolean;
    batch_id?: string;
  };
};

type ExplainResponse = {
  title: string;
  content: string;
  summary?: {
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

type RecommendationRecordDetailResponse = {
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

async function fetchRecommendationRecordDetail(page: Page, runId: string) {
  const detailResponse = await page.request.get(
    `/api/admin/recommendation-records/${runId}`,
  );
  const detailPayload =
    await expectEnvelope<RecommendationRecordDetailResponse>(detailResponse);
  return detailPayload.data;
}

async function selectDealer(page: Page, dealerName: string) {
  const trigger = page.locator('button[role="combobox"]').first();
  await trigger.click();
  await page.getByRole("option", { name: dealerName }).click();
}

function getTraceId(payloadMeta: Record<string, unknown> | undefined, dataTraceId?: string) {
  const metaTraceId = typeof payloadMeta?.trace_id === "string" ? payloadMeta.trace_id : "";
  return metaTraceId || dataTraceId || "";
}

async function expectLangfuseTraceNameIfAvailable(input: {
  traceId: string;
  expectedName: string;
}) {
  if (!input.traceId) {
    return;
  }
  expect(input.traceId).toMatch(/^[a-f0-9]{32}$/);

  const trace = await waitForLangfuseTrace({
    baseUrl: process.env.LANGFUSE_BASE_URL as string,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
    secretKey: process.env.LANGFUSE_SECRET_KEY as string,
    traceId: input.traceId,
    expectedName: input.expectedName,
  });

  expect(trace.name).toBe(input.expectedName);
}

test.describe.configure({ mode: "serial" });

test("live serial cross-role story keeps operations, frontstage, and trace drill-down aligned", async ({
  page,
}) => {
  test.setTimeout(420_000);

  const skipReason = getLiveSkipReason();
  test.skip(!hasRequiredLiveEnv(), skipReason);
  expect(process.env.LLM_MOCK_MODE).not.toBe("true");

  const shared = {
    strategyId: "",
    jobId: "",
    batchId: "",
    runId: "",
    customerId: "",
    customerName: "",
  };

  const strategiesPayload = await expectEnvelope<ListResult<StrategySummary>>(
    await page.request.get(
      "/api/admin/recommendation-strategies?page=1&pageSize=20&status=active&sortBy=priority&sortOrder=asc",
    ),
  );
  const strategy = strategiesPayload.data.items[0];
  if (!strategy) {
    throw new Error("缺少可用推荐策略，无法执行 live 运营故事流。");
  }
  shared.strategyId = strategy.strategy_id;

  await page.goto("/admin/strategy/recommendation-strategies");
  await expect(page).toHaveURL(/\/admin\/strategy\/recommendation-strategies$/);
  await page.getByPlaceholder("搜索策略 ID/名称/场景").fill(shared.strategyId);
  const strategyRow = page.locator("tbody tr", { hasText: shared.strategyId }).first();
  await expect(strategyRow).toBeVisible({
    timeout: 90_000,
  });
  await strategyRow.getByRole("button", { name: "编辑" }).click();

  const strategyNameInput = page
    .locator('label:has-text("策略名称")')
    .locator("xpath=following::input[1]");
  await expect(strategyNameInput).toBeVisible({ timeout: 90_000 });
  const originalName = (await strategyNameInput.inputValue()).trim() || strategy.strategy_name;
  const marker = `live-e2e-${Date.now().toString().slice(-4)}`;
  const baseName = originalName.replace(/\s*\[live-e2e-\d{4}\]$/, "");
  const updatedName = `${baseName} [${marker}]`;
  await strategyNameInput.fill(updatedName);
  await page.getByRole("button", { name: "保存更新" }).click();
  await expect(page.getByText("推荐策略更新成功")).toBeVisible({ timeout: 90_000 });

  const jobsPayload = await expectEnvelope<ListResult<GenerationJobSummary>>(
    await page.request.get(
      "/api/admin/generation-jobs?page=1&pageSize=20&sortBy=business_date&sortOrder=desc",
    ),
  );
  const job = jobsPayload.data.items[0];
  if (!job) {
    throw new Error("缺少可执行生成任务，无法执行 live 运营故事流。");
  }
  shared.jobId = job.job_id;

  await page.goto("/admin/operations/generation-jobs");
  await expect(page).toHaveURL(/\/admin\/operations\/generation-jobs$/);
  await page.getByPlaceholder("搜索任务 ID/名称").fill(shared.jobId);

  const getJobRow = () => page.locator("tbody tr", { hasText: shared.jobId }).first();
  await expect(getJobRow()).toBeVisible({ timeout: 90_000 });

  const precheckResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/admin/generation-jobs/${shared.jobId}/precheck`),
  );
  await getJobRow().getByRole("button", { name: "预检" }).click();
  const precheckPayload = await expectEnvelope<GenerationJobActionResponse>(
    await precheckResponsePromise,
  );
  expect(precheckPayload.data.issues ?? []).toEqual([]);
  await expect(getJobRow()).toContainText("预检通过", { timeout: 90_000 });

  const sampleResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/admin/generation-jobs/${shared.jobId}/sample-generate`),
  );
  await getJobRow().getByRole("button", { name: "试生成" }).click();
  const samplePayload = await expectEnvelope<GenerationJobActionResponse>(
    await sampleResponsePromise,
  );

  expect(samplePayload.data.batch?.batch_id).toMatch(/^batch_/);
  expect(samplePayload.data.generated_run_ids?.length ?? 0).toBeGreaterThan(0);
  expect(samplePayload.data.sampled_customer_ids?.length ?? 0).toBeGreaterThan(0);

  shared.batchId = samplePayload.data.batch?.batch_id ?? "";
  shared.runId =
    samplePayload.data.generated_run_ids?.find((id) => id.startsWith("reco_run_")) ?? "";
  shared.customerId = samplePayload.data.sampled_customer_ids?.[0] ?? "";

  expect(shared.batchId).not.toEqual("");
  expect(shared.runId).not.toEqual("");
  expect(shared.customerId).not.toEqual("");

  const publishResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/admin/generation-jobs/${shared.jobId}/publish`),
  );
  await getJobRow().getByRole("button", { name: "发布" }).click();
  const publishPayload = await expectEnvelope<GenerationJobActionResponse>(
    await publishResponsePromise,
  );

  shared.batchId = publishPayload.data.batch?.batch_id ?? shared.batchId;
  shared.runId =
    publishPayload.data.generated_run_ids?.find((id) => id.startsWith("reco_run_")) ??
    shared.runId;
  shared.customerId = publishPayload.data.sampled_customer_ids?.[0] ?? shared.customerId;

  expect(shared.batchId).toMatch(/^batch_/);
  expect(shared.runId).toMatch(/^reco_run_/);
  expect(shared.customerId).not.toEqual("");
  await expect(getJobRow()).toContainText("已发布", { timeout: 90_000 });

  const dealersPayload = await expectEnvelope<ListResult<DealerSummary>>(
    await page.request.get(
      "/api/admin/dealers?page=1&pageSize=200&status=active&sortBy=customer_name&sortOrder=asc",
    ),
  );
  const matchedDealer = dealersPayload.data.items.find(
    (item) => item.customer_id === shared.customerId,
  );
  expect(matchedDealer).toBeTruthy();
  shared.customerName = matchedDealer?.customer_name ?? "";

  const publishedPayload = await expectEnvelope<PublishedSuggestionsResponse>(
    await page.request.get(
      `/api/frontstage/published-suggestions?customerId=${encodeURIComponent(shared.customerId)}`,
    ),
  );
  expect(publishedPayload.data.summary.published).toBe(true);
  expect(publishedPayload.data.summary.batch_id).toBe(shared.batchId);

  const recommendationRunDetail = await fetchRecommendationRecordDetail(page, shared.runId);
  const recommendationTraceId = recommendationRunDetail.run.trace_id ?? "";
  expect(recommendationRunDetail.run.page_name).toBe("/procurement");
  expect(recommendationRunDetail.run.model_name).toBe(process.env.LLM_MODEL);
  expect(recommendationRunDetail.run.prompt_snapshot).not.toEqual("");

  await clearCart(page);

  await page.goto("/procurement");
  await expect(page).toHaveURL(/\/procurement$/);
  await expect(page.getByTestId("procurement-home")).toBeVisible();
  await expect(page.getByTestId("replenishment-module")).toBeVisible();
  await expect(page.getByTestId("campaign-module")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新采购建议" })).toHaveCount(0);

  await selectDealer(page, shared.customerName);
  await expect(page.getByText("已加载当前已发布建议单，可直接采纳、改量或忽略。")).toBeVisible({
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

  const explainTraceId = explainPayload.data.summary?.trace_id ?? "";
  expect(explainPayload.data.title).not.toEqual("");
  expect(explainPayload.data.content).not.toEqual("");
  await expect(page.locator("body")).toContainText(explainPayload.data.title, {
    timeout: 90_000,
  });

  const applyButton = page.getByRole("button", { name: "采纳/改量" }).first();
  await expect(applyButton).toBeVisible({ timeout: 90_000 });
  await applyButton.click();
  await expect(page.getByText(/已采纳建议：/)).toBeVisible({ timeout: 90_000 });

  const optimizeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart-optimize"),
  );
  await page.getByRole("link", { name: "查看采购清单" }).click();
  await expect(page).toHaveURL(/\/basket$/);
  await expect(page.getByTestId("basket-summary")).toBeVisible();
  await expect(page.getByTestId("basket-optimization-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成优化建议" })).toHaveCount(0);
  const optimizePayload = await expectEnvelope<CartOptimizeResponse>(
    await optimizeResponsePromise,
  );

  const optimizationTraceId = optimizePayload.data.summary.trace_id ?? "";
  const optimizationRunId = optimizePayload.data.summary.recommendation_run_id;

  expect(optimizationRunId).toMatch(/^reco_run_/);

  await page.getByRole("button", { name: "一键应用全部" }).click();
  await expect(page.getByText("已批量应用本轮自动优化建议。")).toBeVisible({
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
  expect(submitPayload.data.order.order_id).toMatch(/^order_/);
  await expect(page.getByText("订单提交成功。")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(submitPayload.data.order.order_id)).toBeVisible({
    timeout: 90_000,
  });

  const optimizationDetail = await fetchRecommendationRecordDetail(page, optimizationRunId);
  expect(optimizationDetail.run.page_name).toBe("/basket");
  expect(optimizationDetail.items.some((item) => item.was_applied)).toBe(true);
  expect(
    optimizationDetail.items.some((item) => item.final_status === "submitted_with_order"),
  ).toBe(true);

  await page.goto("/admin/operations/recommendation-batches");
  await expect(page).toHaveURL(/\/admin\/operations\/recommendation-batches$/);
  await page.getByPlaceholder("batch_id / trace_id").fill(shared.batchId);
  await page.getByRole("button", { name: "查询" }).first().click();

  const batchRow = page.locator("tbody tr", { hasText: shared.batchId }).first();
  await expect(batchRow).toBeVisible({ timeout: 90_000 });
  await batchRow.click();

  await page.getByRole("link", { name: "查看批次记录" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/analytics/recommendation-records\\?batchId=${encodeURIComponent(shared.batchId)}`,
    ),
  );
  await expect(page.getByTestId("recommendation-report-table")).toBeVisible();

  const reportRows = page.locator('[data-testid="recommendation-report-table"] tbody tr');
  await expect(reportRows.first()).not.toContainText("加载中...");
  if ((await reportRows.first().textContent())?.includes("无数据")) {
    const batchIdFilterInput = page
      .locator('label:has-text("批次 ID")')
      .locator("xpath=following::input[1]");
    await batchIdFilterInput.fill("");
    await page.getByRole("button", { name: "查询" }).click();
  }
  await expect(reportRows.first()).not.toContainText("无数据");

  const runRow = page
    .locator('[data-testid="recommendation-report-table"] tbody tr', { hasText: shared.runId })
    .first();
  const rowToClick = (await runRow.count()) > 0 ? runRow : reportRows.first();
  await expect(rowToClick).toBeVisible({ timeout: 90_000 });
  await rowToClick.click();
  await expect(page.getByTestId("trace-link")).toBeVisible({ timeout: 90_000 });

  const sameBatchTraceLink = page.getByRole("link", { name: "查看同批次链路" });
  if (await sameBatchTraceLink.count()) {
    await sameBatchTraceLink.click();
  } else {
    await page.getByRole("link", { name: "前往链路观察" }).click();
  }
  await expect(page).toHaveURL(/\/admin\/observability\/traces/);

  const traceRows = page.locator("tbody tr");
  await expect(traceRows.first()).not.toContainText("加载中...");
  if ((await traceRows.first().textContent())?.includes("暂无链路数据")) {
    const batchIdTraceFilterInput = page
      .locator('label:has-text("批次 ID")')
      .locator("xpath=following::input[1]");
    await batchIdTraceFilterInput.fill("");
    await page.getByRole("button", { name: "查询" }).click();
  }
  await expect(traceRows.first()).not.toContainText("暂无链路数据");

  const traceRowById = recommendationTraceId
    ? page.locator("tbody tr", { hasText: recommendationTraceId }).first()
    : page.locator("tbody tr").first();
  const traceRow = (await traceRowById.count()) > 0 ? traceRowById : traceRows.first();
  await expect(traceRow).toBeVisible({ timeout: 90_000 });
  await traceRow.click();
  await expect(page.getByTestId("trace-link")).toBeVisible({ timeout: 90_000 });

  await expectLangfuseTraceNameIfAvailable({
    traceId: recommendationTraceId,
    expectedName: "homepage.generate-recommendations",
  });
  await expectLangfuseTraceNameIfAvailable({
    traceId: explainTraceId,
    expectedName: "recommendation.explain",
  });
  await expectLangfuseTraceNameIfAvailable({
    traceId: optimizationTraceId,
    expectedName: "cart.generate-optimization",
  });
  await expectLangfuseTraceNameIfAvailable({
    traceId: submitTraceId,
    expectedName: "confirm.submit-order",
  });
});
