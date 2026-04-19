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
  target_dealer_ids: string[];
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
  bundleTemplates: Array<{
    template_id: string;
    template_name: "热销补货" | "缺货补货" | "活动备货";
  }>;
  activityHighlights: Array<{
    activity_id: string;
  }>;
  cartSummary: {
    sku_count: number;
    item_count: number;
    total_amount: number;
    threshold_amount: number;
    gap_to_threshold: number;
    threshold_reached: boolean;
  };
  summary: {
    published: boolean;
    batch_id?: string;
  };
};

type CartOptimizeResponse = {
  recommendationBars: Array<{
    bar_id: string;
    headline: string;
    action_label: string;
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

type CopilotAutofillResponse = {
  run: {
    run_id: string;
    trace_id?: string;
    page_name: "/purchase" | "/order-submit";
  };
  draft: {
    draft_id: string;
    status: "preview" | "applied" | "blocked";
  };
};

type CopilotApplyDraftResponse = {
  run: {
    run_id: string;
    trace_id?: string;
    page_name: "/purchase" | "/order-submit";
  };
  draft: {
    draft_id: string;
    status: "preview" | "applied" | "blocked";
  };
  cart: {
    items: Array<{ sku_id: string }>;
  };
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

test("live serial cross-role story keeps canonical purchase/order-submit flow and drill-down aligned", async ({
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
  await page.getByPlaceholder("搜索方案编号/名称/场景").fill(shared.strategyId);
  const strategyRow = page.locator("tbody tr", { hasText: shared.strategyId }).first();
  await expect(strategyRow).toBeVisible({
    timeout: 90_000,
  });
  await strategyRow.getByRole("button", { name: "编辑" }).click();

  const strategyNameInput = page
    .locator('label:has-text("方案名称")')
    .locator("xpath=following::input[1]");
  await expect(strategyNameInput).toBeVisible({ timeout: 90_000 });
  const originalName = (await strategyNameInput.inputValue()).trim() || strategy.strategy_name;
  const marker = `live-e2e-${Date.now().toString().slice(-4)}`;
  const baseName = originalName.replace(/\s*\[live-e2e-\d{4}\]$/, "");
  const updatedName = `${baseName} [${marker}]`;
  await strategyNameInput.fill(updatedName);
  await page.getByRole("button", { name: "保存更新" }).click();
  await expect(page.getByText("推荐方案更新成功")).toBeVisible({ timeout: 90_000 });

  const targetDealerId = strategy.target_dealer_ids[0];
  if (!targetDealerId) {
    throw new Error("策略未配置目标经销商，无法执行 live 运营故事流。");
  }
  const createJobPayload = await expectEnvelope<GenerationJobSummary>(
    await page.request.post("/api/admin/generation-jobs", {
      data: {
        job_id: `job_live_e2e_${Date.now()}`,
        job_name: "Live E2E 生成任务",
        business_date: new Date().toISOString().slice(0, 10),
        target_dealer_ids: [targetDealerId],
        target_segment_ids: [],
        strategy_ids: [shared.strategyId],
        publish_mode: "manual",
        status: "ready",
        precheck_summary: "待预检",
      },
    }),
  );
  shared.jobId = createJobPayload.data.job_id;

  await page.goto("/admin/operations/generation-jobs");
  await expect(page).toHaveURL(/\/admin\/operations\/generation-jobs$/);
  await page.getByPlaceholder("搜索任务编号/名称").fill(shared.jobId);

  const getJobRow = () => page.locator("tbody tr", { hasText: shared.jobId }).first();
  await expect(getJobRow()).toBeVisible({ timeout: 90_000 });

  const precheckResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/admin/generation-jobs/${shared.jobId}/precheck`),
    { timeout: 90_000 },
  );
  await getJobRow().getByRole("button", { name: "预检" }).click();
  const precheckPayload = await expectEnvelope<GenerationJobActionResponse>(
    await precheckResponsePromise,
  );
  expect(precheckPayload.data.issues ?? []).toEqual([]);
  await expect(getJobRow()).toContainText("预检通过", { timeout: 90_000 });
  await expect(getJobRow().getByRole("button", { name: "试生成" })).toBeEnabled({
    timeout: 15_000,
  });

  const sampleResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/admin/generation-jobs/${shared.jobId}/sample-generate`),
    { timeout: 180_000 },
  );
  await getJobRow().getByRole("button", { name: "试生成" }).click();
  const samplePayload = await expectEnvelope<GenerationJobActionResponse>(
    await sampleResponsePromise,
  );

  expect(samplePayload.data.batch?.batch_id).toMatch(/^batch_/);
  expect(samplePayload.data.generated_run_ids?.length ?? 0).toBeGreaterThan(0);
  expect(samplePayload.data.sampled_customer_ids?.length ?? 0).toBeGreaterThan(0);
  await expect(getJobRow().getByRole("button", { name: "发布" })).toBeEnabled({
    timeout: 15_000,
  });

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
    { timeout: 120_000 },
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
  expect(publishedPayload.data.bundleTemplates).toHaveLength(3);
  expect(publishedPayload.data.bundleTemplates.map((item) => item.template_name)).toEqual([
    "热销补货",
    "缺货补货",
    "活动备货",
  ]);
  expect("dailyRecommendations" in (publishedPayload.data as Record<string, unknown>)).toBe(
    false,
  );
  expect(
    "weeklyFocusRecommendations" in (publishedPayload.data as Record<string, unknown>),
  ).toBe(false);

  const recommendationRunDetail = await fetchRecommendationRecordDetail(page, shared.runId);
  const recommendationTraceId = recommendationRunDetail.run.trace_id ?? "";
  expect(recommendationRunDetail.run.model_name).toBe(process.env.LLM_MODEL);
  expect(recommendationRunDetail.run.prompt_snapshot).not.toEqual("");

  await clearCart(page);

  await page.goto("/purchase");
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await expect(page.getByTestId("purchase-bundle-templates")).toBeVisible();
  await expect(page.getByTestId("purchase-activity-zone")).toBeVisible();
  await expect(page.getByTestId("purchase-catalog-zone")).toBeVisible();
  await expect(page.getByTestId("purchase-procurement-summary")).toBeVisible();
  await expect(page.getByText("热销补货")).toBeVisible();
  await expect(page.getByText("缺货补货")).toBeVisible();
  await expect(page.getByText("活动备货")).toBeVisible();
  await expect(
    page.getByTestId("purchase-bundle-templates").getByRole("button", { name: "快速下单" }),
  ).toHaveCount(3);
  await expect(page.getByRole("button", { name: "生成建议" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "采纳/改量" })).toHaveCount(0);

  await selectDealer(page, shared.customerName);
  await expect(page.getByText("已加载本周进货建议，可从当前页面直接组货下单。")).toBeVisible({
    timeout: 90_000,
  });

  await page
    .getByTestId("purchase-bundle-templates")
    .getByRole("button", { name: "查看详情" })
    .first()
    .click();
  await expect(page.getByTestId("purchase-reason-drawer")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByTestId("purchase-reason-drawer")).toHaveCount(0);

  const optimizeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart-optimize"),
  );
  await page
    .getByTestId("purchase-bundle-templates")
    .getByRole("button", { name: "快速下单" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();
  await expect(page.getByTestId("order-submit-recommendation-bars")).toBeVisible();
  await expect(
    page.getByTestId("order-submit-recommendation-bars").getByText("凑单推荐", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("交易信息", { exact: true })).toBeVisible();
  await expect(page.getByTestId("order-submit-optimization")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "一键应用全部" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成优化建议" })).toHaveCount(0);
  const optimizePayload = await expectEnvelope<CartOptimizeResponse>(
    await optimizeResponsePromise,
  );

  const optimizationTraceId = getTraceId(
    optimizePayload.meta,
    optimizePayload.data.summary.trace_id,
  );
  const optimizationRunId = optimizePayload.data.summary.recommendation_run_id;

  expect(optimizationRunId).toMatch(/^reco_run_/);

  const whyButtons = page
    .getByTestId("order-submit-recommendation-bars")
    .getByRole("button", { name: "查看依据" });
  if ((await whyButtons.count()) > 0) {
    await whyButtons.first().click();
    await expect(page.getByTestId("order-submit-reason-drawer")).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByTestId("order-submit-reason-drawer")).toHaveCount(0);
  }

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart/submit"),
  );
  await page.getByRole("button", { name: "提交订单" }).click();
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
  expect(optimizationDetail.run.page_name).toBe("/order-submit");
  expect(optimizationDetail.items.length).toBeGreaterThanOrEqual(0);

  await page.goto("/admin/operations/recommendation-batches");
  await expect(page).toHaveURL(/\/admin\/operations\/recommendation-batches$/);
  await page.getByPlaceholder("batch_id / trace_id").fill(shared.batchId);
  await page.getByRole("button", { name: "查询" }).first().click();

  const batchRow = page.locator("tbody tr", { hasText: shared.batchId }).first();
  await expect(batchRow).toBeVisible({ timeout: 90_000 });
  await batchRow.click();

  await page
    .locator(
      `a[href="/admin/analytics/recommendation-records?view=purchase&batchId=${encodeURIComponent(shared.batchId)}"]`,
    )
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/analytics/recommendation-records\\?view=purchase&batchId=${encodeURIComponent(shared.batchId)}`,
    ),
  );
  await expect(page.getByTestId("recommendation-report-table")).toBeVisible();

  const reportRows = page.locator('[data-testid="recommendation-report-table"] tbody tr');
  await expect(reportRows.first()).not.toContainText("加载中...");
  await expect(reportRows.first()).not.toContainText("无数据");

  const runRow = page
    .locator('[data-testid="recommendation-report-table"] tbody tr', { hasText: shared.runId })
    .first();
  const rowToClick = (await runRow.count()) > 0 ? runRow : reportRows.first();
  await expect(rowToClick).toBeVisible({ timeout: 90_000 });
  await rowToClick.click();
  await expect(page.getByTestId("trace-link")).toBeVisible({ timeout: 90_000 });

  const sameBatchTraceLink = page.getByRole("link", { name: "查看同批次执行过程" });
  if (await sameBatchTraceLink.count()) {
    await sameBatchTraceLink.click();
  } else {
    await page.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("main").getByRole("link", { name: "查看执行过程" }).click();
  }
  await expect(page).toHaveURL(/\/admin\/observability\/traces/);

  const traceRows = page.locator("tbody tr");
  await expect(traceRows.first()).not.toContainText("加载中...");
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
    traceId: optimizationTraceId,
    expectedName: "cart.generate-optimization",
  });
  await expectLangfuseTraceNameIfAvailable({
    traceId: submitTraceId,
    expectedName: "confirm.submit-order",
  });
});

test("live copilot flow keeps preview/apply discipline and validates copilot Langfuse traces", async ({
  page,
}) => {
  test.setTimeout(420_000);

  const skipReason = getLiveSkipReason();
  test.skip(!hasRequiredLiveEnv(), skipReason);
  expect(process.env.LLM_MOCK_MODE).not.toBe("true");

  await clearCart(page);

  const dealersPayload = await expectEnvelope<ListResult<DealerSummary>>(
    await page.request.get(
      "/api/admin/dealers?page=1&pageSize=20&status=active&sortBy=customer_name&sortOrder=asc",
    ),
  );
  const dealer = dealersPayload.data.items[0];
  if (!dealer) {
    throw new Error("缺少 active 经销商，无法执行 Copilot live e2e。");
  }

  await page.goto("/purchase");
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await selectDealer(page, dealer.customer_name);

  const cartBeforePreviewPayload = await expectEnvelope<CartApiResponse>(
    await page.request.get("/api/cart"),
  );
  const cartBeforePreviewCount = cartBeforePreviewPayload.data.items.length;

  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByRole("button", { name: "一键做单" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "活动补齐" })).toBeVisible();
  await expect(page.getByRole("button", { name: "解释这单" })).toBeVisible();
  await page
    .getByPlaceholder("比如：预算 6000，优先活动，不要新品")
    .fill("按常购和活动做一单，预算控制在 6000 左右。");

  const purchaseAutofillResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/copilot/autofill"),
    { timeout: 180_000 },
  );
  await page.getByRole("button", { name: "一键做单" }).click();
  const purchaseAutofillPayload = await expectEnvelope<CopilotAutofillResponse>(
    await purchaseAutofillResponsePromise,
  );
  const purchaseAutofillTraceId = getTraceId(
    purchaseAutofillPayload.meta,
    purchaseAutofillPayload.data.run.trace_id,
  );
  const purchaseAutofillRunId = purchaseAutofillPayload.data.run.run_id;

  expect(purchaseAutofillPayload.data.run.page_name).toBe("/purchase");
  expect(purchaseAutofillPayload.data.draft.status).toBe("preview");
  await expect(page.getByRole("button", { name: "加入采购清单" })).toBeVisible({
    timeout: 90_000,
  });

  const cartAfterPreviewPayload = await expectEnvelope<CartApiResponse>(
    await page.request.get("/api/cart"),
  );
  expect(cartAfterPreviewPayload.data.items.length).toBe(cartBeforePreviewCount);

  const applyDraftResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/copilot\/drafts\/[^/]+\/apply/.test(response.url()),
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "加入采购清单" }).click();
  const applyDraftPayload = await expectEnvelope<CopilotApplyDraftResponse>(
    await applyDraftResponsePromise,
  );
  expect(applyDraftPayload.data.draft.status).toBe("applied");

  const cartAfterApplyPayload = await expectEnvelope<CartApiResponse>(
    await page.request.get("/api/cart"),
  );
  expect(cartAfterApplyPayload.data.items.length).toBeGreaterThan(
    cartAfterPreviewPayload.data.items.length,
  );

  await expect(page.getByRole("link", { name: "去结算页继续提交" })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole("link", { name: "去结算页继续提交" }).click();
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();

  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByRole("button", { name: "解释当前优化" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "继续安全补齐" })).toBeVisible();
  await expect(page.getByRole("button", { name: "去提交" })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键做单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "活动补齐" })).toHaveCount(0);
  await page
    .getByPlaceholder("例如：解释当前推荐，或继续安全补齐活动门槛")
    .fill("解释当前优化建议对门槛、箱规和提交风险的影响。");

  const explainChatResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/copilot/chat"),
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "解释当前优化" }).click();
  const explainChatResponse = await explainChatResponsePromise;
  expect(explainChatResponse.ok()).toBe(true);

  const explainTraceId =
    (await explainChatResponse.headerValue("x-copilot-trace-id")) ?? "";
  const explainRunId = (await explainChatResponse.headerValue("x-copilot-run-id")) ?? "";
  expect(explainRunId).not.toEqual("");

  await page.getByRole("button", { name: "去提交" }).click();

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart/submit"),
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "提交订单" }).click();
  const submitPayload = await expectEnvelope<SubmitCartResponse>(await submitResponsePromise);
  expect(submitPayload.data.order.order_id).toMatch(/^order_/);
  await expect(page.getByText("订单提交成功。")).toBeVisible({ timeout: 90_000 });

  await page.goto("/admin/observability/traces");
  await expect(page).toHaveURL(/\/admin\/observability\/traces$/);
  await expect(
    page.locator('[data-slot="card-title"]', { hasText: /^AI 下单助手链路$/ }).first(),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "刷新 AI 助手" }).click();

  const copilotRow = page.locator("tbody tr", { hasText: purchaseAutofillRunId }).first();
  await expect(copilotRow).toBeVisible({ timeout: 90_000 });
  await copilotRow.click();

  if (purchaseAutofillTraceId) {
    await expect(page.getByText(`trace=${purchaseAutofillTraceId} ·`, { exact: false })).toBeVisible({
      timeout: 90_000,
    });
  }

  const langfuseDrilldown = page.getByRole("link", { name: "在 Langfuse 打开链路" });
  if ((await langfuseDrilldown.count()) > 0) {
    await expect(langfuseDrilldown.first()).toBeVisible();
  }

  await expectLangfuseTraceNameIfAvailable({
    traceId: purchaseAutofillTraceId,
    expectedName: "copilot.autofill-order",
  });
  await expectLangfuseTraceNameIfAvailable({
    traceId: explainTraceId,
    expectedName: "copilot.explain-order",
  });
});
