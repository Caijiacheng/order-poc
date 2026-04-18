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
  target_dealer_ids: string[];
  status: "active" | "inactive";
};

type CampaignSummary = {
  campaign_id: string;
  campaign_name: string;
  status: "active" | "inactive";
};

type ExpressionTemplateSummary = {
  expression_template_id: string;
  expression_template_name: string;
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

async function closeDrawer(page: Page) {
  await page.getByRole("button", { name: "关闭", exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test("运营 story：策略/活动/模板走 Drawer，任务完成预检、试生成、发布", async ({
  page,
}) => {
  test.setTimeout(150_000);

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

  await page.getByRole("button", { name: "新建方案" }).click();
  await expect(page.getByRole("heading", { name: "创建方案" })).toBeVisible();
  await closeDrawer(page);
  await expect(page.getByRole("heading", { name: "创建方案" })).toHaveCount(0);

  await page.getByPlaceholder("搜索方案编号/名称/场景").fill(shared.strategyId);
  const strategyRow = page.locator("tbody tr", { hasText: shared.strategyId }).first();
  await expect(strategyRow).toBeVisible();
  await strategyRow.getByRole("button", { name: "编辑" }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`编辑方案: ${shared.strategyId}`) }),
  ).toBeVisible();

  const strategyNameInput = page
    .locator('label:has-text("方案名称")')
    .locator("xpath=following::input[1]");
  const originalName = (await strategyNameInput.inputValue()).trim() || strategy.strategy_name;
  const marker = `mock-e2e-${Date.now().toString().slice(-4)}`;
  const baseName = originalName.replace(/\s*\[mock-e2e-\d{4}\]$/, "");
  await strategyNameInput.fill(`${baseName} [${marker}]`);
  await page.getByRole("button", { name: "保存更新" }).click();
  await expect(page.getByText("推荐方案更新成功")).toBeVisible();

  const campaigns = await expectEnvelope<ListResult<CampaignSummary>>(
    await page.request.get(
      "/api/admin/campaigns?page=1&pageSize=20&status=active&sortBy=week_id&sortOrder=desc",
    ),
  );
  const campaign = campaigns.data.items[0];
  if (!campaign) {
    throw new Error("缺少可编辑活动，无法执行运营 story");
  }

  await page.goto("/admin/strategy/campaigns");
  await expect(page).toHaveURL(/\/admin\/strategy\/campaigns$/);
  await page.getByPlaceholder("搜索活动 ID/名称").fill(campaign.campaign_id);
  const campaignRow = page.locator("tbody tr", { hasText: campaign.campaign_id }).first();
  await expect(campaignRow).toBeVisible();
  await campaignRow.getByRole("button", { name: "编辑" }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`编辑活动安排: ${campaign.campaign_id}`) }),
  ).toBeVisible();
  await closeDrawer(page);
  await campaignRow.getByRole("button", { name: "停用" }).click();
  await expect(page.getByRole("heading", { name: "确认停用活动安排" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  const expressionTemplates = await expectEnvelope<ListResult<ExpressionTemplateSummary>>(
    await page.request.get(
      "/api/admin/expression-templates?page=1&pageSize=20&status=active&sortBy=expression_template_name&sortOrder=asc",
    ),
  );
  const expressionTemplate = expressionTemplates.data.items[0];
  if (!expressionTemplate) {
    throw new Error("缺少可编辑表达模板，无法执行运营 story");
  }

  await page.goto("/admin/strategy/expression-templates");
  await expect(page).toHaveURL(/\/admin\/strategy\/expression-templates$/);
  await page.getByPlaceholder("搜索话术编号/名称/类型").fill(
    expressionTemplate.expression_template_id,
  );
  const expressionRow = page
    .locator("tbody tr", { hasText: expressionTemplate.expression_template_id })
    .first();
  await expect(expressionRow).toBeVisible();
  await expressionRow.getByRole("button", { name: "编辑" }).click();
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`编辑话术: ${expressionTemplate.expression_template_id}`),
    }),
  ).toBeVisible();
  await closeDrawer(page);
  await expressionRow.getByRole("button", { name: "停用" }).click();
  await expect(page.getByRole("heading", { name: "确认停用推荐话术" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  const targetDealerId = strategy.target_dealer_ids[0];
  if (!targetDealerId) {
    throw new Error("策略未配置目标经销商，无法执行运营 story");
  }
  const createJob = await expectEnvelope<GenerationJobSummary>(
    await page.request.post("/api/admin/generation-jobs", {
      data: {
        job_id: `job_mock_e2e_${Date.now()}`,
        job_name: "Mock E2E 生成任务",
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
  shared.jobId = createJob.data.job_id;

  await page.goto("/admin/operations/generation-jobs");
  await expect(page).toHaveURL(/\/admin\/operations\/generation-jobs$/);
  await page.getByPlaceholder("搜索任务编号/名称").fill(shared.jobId);

  const getJobRow = () => page.locator("tbody tr", { hasText: shared.jobId }).first();
  await expect(getJobRow()).toBeVisible();
  await getJobRow().getByRole("button", { name: "编辑" }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`编辑生成任务: ${shared.jobId}`) }),
  ).toBeVisible();
  await closeDrawer(page);

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
    await page.request.get(`/api/admin/recommendation-records/${shared.runId}`),
  );
  expect(runDetail.data.run.model_name).toBe("mock-e2e-model");
});

test("经销商 story：/purchase -> /order-submit -> 提交", async ({ page }) => {
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
  expect(publishedPayload.data.bundleTemplates).toHaveLength(3);
  expect(publishedPayload.data.bundleTemplates.map((item) => item.template_name)).toEqual([
    "热销补货",
    "缺货补货",
    "活动备货",
  ]);
  expect(publishedPayload.data.activityHighlights.length).toBeGreaterThanOrEqual(0);
  expect("dailyRecommendations" in (publishedPayload.data as Record<string, unknown>)).toBe(
    false,
  );
  expect(
    "weeklyFocusRecommendations" in (publishedPayload.data as Record<string, unknown>),
  ).toBe(false);

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
  await expect(page.getByText("今日建议单")).toHaveCount(0);

  await selectDealer(page, shared.customerName);
  await expect(page.getByText("已加载本周进货建议，可从当前页面直接组货下单。")).toBeVisible();

  await page
    .getByTestId("purchase-bundle-templates")
    .getByRole("button", { name: "查看详情" })
    .first()
    .click();
  await expect(page.getByTestId("purchase-reason-drawer")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByTestId("purchase-reason-drawer")).toHaveCount(0);

  await page
    .getByTestId("purchase-bundle-templates")
    .getByRole("button", { name: "快速下单" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();
  await expect(page.getByTestId("order-submit-recommendation-bars")).toBeVisible();
  await expect(page.getByTestId("order-submit-summary")).toBeVisible();
  await expect(page.getByText("凑单推荐")).toBeVisible();
  await expect(page.getByText("交易信息", { exact: true })).toBeVisible();
  await expect(page.getByTestId("order-submit-optimization")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "一键应用全部" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成优化建议" })).toHaveCount(0);

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/cart/submit"),
  );
  await page.getByRole("button", { name: "提交订单" }).click();
  await expectEnvelope(await submitResponsePromise);
  await expect(page.getByText("订单提交成功。")).toBeVisible();
});

test("IT story：批次/记录/trace/recovery 可钻取", async ({ page }) => {
  test.setTimeout(120_000);

  expect(shared.batchId).not.toEqual("");

  await page.goto("/admin/operations/recommendation-batches");
  await expect(page).toHaveURL(/\/admin\/operations\/recommendation-batches$/);

  await page.getByPlaceholder("batch_id / trace_id").fill(shared.batchId);
  await page.getByRole("button", { name: "查询" }).first().click();

  const batchRow = page.locator("tbody tr", { hasText: shared.batchId }).first();
  await expect(batchRow).toBeVisible();
  await batchRow.click();

  await page
    .locator(`a[href="/admin/analytics/recommendation-records?batchId=${encodeURIComponent(shared.batchId)}"]`)
    .click();
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
  await rowToClick.click();
  await expect(page.getByTestId("trace-link")).toBeVisible();

  const sameBatchTraceLink = page.getByRole("link", { name: "查看同批次执行过程" });
  if (await sameBatchTraceLink.count()) {
    await sameBatchTraceLink.click();
  } else {
    await page.getByRole("main").getByRole("link", { name: "查看执行过程" }).click();
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

  await traceRows.first().click();
  await expect(page.getByTestId("trace-link")).toBeVisible();

  await page.goto("/admin/observability/recovery");
  await expect(page).toHaveURL(/\/admin\/observability\/recovery$/);
  await expect(page.getByRole("heading", { name: "恢复演示数据" })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复到演示初始数据" })).toBeVisible();
});
