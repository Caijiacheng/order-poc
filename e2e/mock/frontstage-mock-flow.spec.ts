import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type ApiEnvelope<TData> = {
  success: boolean;
  data: TData;
  meta?: Record<string, unknown>;
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

type CartApiResponse = {
  items: Array<{ sku_id: string }>;
};

type PublishedSuggestionsResponse = {
  summary: {
    published: boolean;
    batch_id?: string;
  };
};

type RecommendationRunDetailResponse = {
  run: {
    model_name: string;
  };
};

type SharedContext = {
  strategyId: string;
  jobId: string;
  batchId: string;
  runId: string;
  customerId: string;
  customerName: string;
};

const shared: SharedContext = {
  strategyId: "",
  jobId: "",
  batchId: "",
  runId: "",
  customerId: "",
  customerName: "",
};

async function expectEnvelope<TData>(response: APIResponse | Response) {
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as ApiEnvelope<TData>;
  expect(payload.success).toBe(true);
  return payload;
}

async function clearCart(page: Page) {
  const cartPayload = await expectEnvelope<CartApiResponse>(await page.request.get("/api/cart"));
  for (const item of cartPayload.data.items) {
    const deleteResponse = await page.request.delete(`/api/cart/items/${item.sku_id}`);
    expect(deleteResponse.ok()).toBe(true);
  }
}

async function selectDealer(page: Page, dealerName: string) {
  const trigger = page.locator('button[role="combobox"]').first();
  await trigger.click();
  await page.getByRole("option", { name: dealerName }).click();
}

test.describe.configure({ mode: "serial" });

test("运营 story：策略最小改动后完成预检、试生成、发布", async ({ page }) => {
  test.setTimeout(120_000);

  const strategies = await expectEnvelope<ListResult<StrategySummary>>(
    await page.request.get(
      "/api/admin/recommendation-strategies?page=1&pageSize=20&status=active&sortBy=priority&sortOrder=asc",
    ),
  );
  const strategy = strategies.data.items[0];
  if (!strategy) {
    throw new Error("缺少可编辑策略，无法执行运营 story");
  }
  shared.strategyId = strategy.strategy_id;

  await page.goto("/admin/strategy/recommendation-strategies");
  await expect(page).toHaveURL(/\/admin\/strategy\/recommendation-strategies$/);
  await page.getByPlaceholder("搜索策略 ID/名称/场景").fill(shared.strategyId);

  const strategyRow = page.locator("tbody tr", { hasText: shared.strategyId }).first();
  await expect(strategyRow).toBeVisible();
  await strategyRow.getByRole("button", { name: "编辑" }).click();

  const strategyNameInput = page
    .locator('label:has-text("策略名称")')
    .locator("xpath=following::input[1]");
  await expect(strategyNameInput).toBeVisible();
  const originalName = (await strategyNameInput.inputValue()).trim() || strategy.strategy_name;
  const updatedName = `${originalName} [mock-e2e]`;
  await strategyNameInput.fill(updatedName);
  await page.getByRole("button", { name: "保存更新" }).click();
  await expect(page.getByText("推荐策略更新成功")).toBeVisible();

  const jobs = await expectEnvelope<ListResult<GenerationJobSummary>>(
    await page.request.get(
      "/api/admin/generation-jobs?page=1&pageSize=20&sortBy=business_date&sortOrder=desc",
    ),
  );
  const job = jobs.data.items[0];
  if (!job) {
    throw new Error("缺少可执行生成任务，无法执行运营 story");
  }
  shared.jobId = job.job_id;

  await page.goto("/admin/operations/generation-jobs");
  await expect(page).toHaveURL(/\/admin\/operations\/generation-jobs$/);
  await page.getByPlaceholder("搜索任务 ID/名称").fill(shared.jobId);

  const getJobRow = () => page.locator("tbody tr", { hasText: shared.jobId }).first();

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
  await expect(getJobRow()).toContainText("预检通过");
  await expect(getJobRow().getByRole("button", { name: "试生成" })).toBeEnabled({
    timeout: 15_000,
  });

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
  await expect(getJobRow().getByRole("button", { name: "发布" })).toBeEnabled({
    timeout: 15_000,
  });

  shared.batchId = samplePayload.data.batch?.batch_id ?? "";
  shared.runId = samplePayload.data.generated_run_ids?.[0] ?? "";
  shared.customerId = samplePayload.data.sampled_customer_ids?.[0] ?? "";

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
  shared.runId = publishPayload.data.generated_run_ids?.[0] ?? shared.runId;
  expect(shared.batchId).not.toEqual("");
  expect(shared.runId).not.toEqual("");
  expect(shared.customerId).not.toEqual("");
  await expect(getJobRow()).toContainText("已发布");

  const dealers = await expectEnvelope<ListResult<DealerSummary>>(
    await page.request.get(
      "/api/admin/dealers?page=1&pageSize=200&status=active&sortBy=customer_name&sortOrder=asc",
    ),
  );
  const currentDealer = dealers.data.items.find((item) => item.customer_id === shared.customerId);
  expect(currentDealer).toBeTruthy();
  shared.customerName = currentDealer?.customer_name ?? "";

  const runDetail = await expectEnvelope<RecommendationRunDetailResponse>(
    await page.request.get(`/api/admin/reports/recommendations/${shared.runId}`),
  );
  expect(runDetail.data.run.model_name).toBe("mock-e2e-model");
});

test("经销商 story：自动消费已发布建议单、自动看到凑单优化并提交订单", async ({ page }) => {
  test.setTimeout(120_000);

  expect(shared.customerId).not.toEqual("");
  expect(shared.batchId).not.toEqual("");

  await clearCart(page);

  const publishedPayload = await expectEnvelope<PublishedSuggestionsResponse>(
    await page.request.get(
      `/api/frontstage/published-suggestions?customerId=${encodeURIComponent(shared.customerId)}`,
    ),
  );
  expect(publishedPayload.data.summary.published).toBe(true);
  expect(publishedPayload.data.summary.batch_id).toBe(shared.batchId);

  await page.goto("/procurement");
  await expect(page).toHaveURL(/\/procurement$/);
  await expect(page.getByTestId("procurement-home")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新采购建议" })).toHaveCount(0);

  await selectDealer(page, shared.customerName);
  await expect(page.getByText("已加载当前已发布建议单，可直接采纳、改量或忽略。")).toBeVisible();

  const applyButton = page.getByRole("button", { name: "采纳/改量" }).first();
  await expect(applyButton).toBeVisible();
  await applyButton.click();
  await expect(page.getByText(/已采纳建议：/)).toBeVisible();

  await page.getByRole("link", { name: "查看采购清单" }).click();
  await expect(page).toHaveURL(/\/basket$/);
  await expect(page.getByTestId("basket-summary")).toBeVisible();
  await expect(page.getByTestId("basket-optimization-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成优化建议" })).toHaveCount(0);

  await page.getByRole("link", { name: "去下单确认" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("checkout-summary")).toBeVisible();

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart/submit"),
  );
  await page.getByRole("button", { name: "确认提交订单" }).click();
  await expectEnvelope(await submitResponsePromise);
  await expect(page.getByText("订单提交成功。")).toBeVisible();
});

test("IT story：按批次下钻记录与 trace，并查看 recovery 页面", async ({ page }) => {
  test.setTimeout(120_000);

  expect(shared.batchId).not.toEqual("");

  await page.goto("/admin/operations/recommendation-batches");
  await expect(page).toHaveURL(/\/admin\/operations\/recommendation-batches$/);

  await page.getByPlaceholder("batch_id / trace_id").fill(shared.batchId);
  await page.getByRole("button", { name: "查询" }).first().click();

  const batchRow = page.locator("tbody tr", { hasText: shared.batchId }).first();
  await expect(batchRow).toBeVisible();
  await batchRow.click();

  await page.getByRole("link", { name: "查看批次记录" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/analytics/recommendation-records\\?batchId=${encodeURIComponent(shared.batchId)}`),
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
  await reportRows.first().click();
  await expect(page.getByTestId("trace-link")).toBeVisible();

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

  const traceRow = traceRows.first();
  await traceRow.click();
  await expect(page.getByTestId("trace-link")).toBeVisible();

  await page.goto("/admin/observability/recovery");
  await expect(page).toHaveURL(/\/admin\/observability\/recovery$/);
  await expect(page.getByRole("heading", { name: "回滚中心" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).not.toContainText("暂无恢复快照");
});
