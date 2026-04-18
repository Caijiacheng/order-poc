import { expect, test, type APIResponse, type Page, type Request, type Response } from "@playwright/test";

type ApiEnvelope<TData> = {
  success: boolean;
  data: TData;
  meta?: Record<string, unknown>;
};

type ListResult<TItem> = {
  items: TItem[];
  total: number;
};

type DealerSummary = {
  customer_id: string;
  customer_name: string;
};

type CartApiResponse = {
  summary: {
    item_count: number;
    total_amount: number;
  };
  items: Array<{
    sku_id: string;
  }>;
};

type CopilotAutofillApiResponse = {
  run: {
    run_id: string;
  };
  draft: {
    draft_id: string;
    status: "preview" | "applied" | "blocked";
  };
};

async function expectEnvelope<TData>(response: APIResponse | Response) {
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as ApiEnvelope<TData>;
  expect(payload.success).toBe(true);
  return payload;
}

async function fetchActiveDealer(page: Page) {
  const dealersPayload = await expectEnvelope<ListResult<DealerSummary>>(
    await page.request.get(
      "/api/admin/dealers?page=1&pageSize=20&status=active&sortBy=customer_name&sortOrder=asc",
    ),
  );
  const dealer = dealersPayload.data.items[0];
  if (!dealer) {
    throw new Error("缺少 active 经销商，无法执行 Copilot mock e2e。");
  }
  return dealer;
}

async function fetchCart(page: Page) {
  const cartPayload = await expectEnvelope<CartApiResponse>(await page.request.get("/api/cart"));
  return cartPayload.data;
}

async function clearCart(page: Page) {
  const cart = await fetchCart(page);
  for (const item of cart.items) {
    const deleteResponse = await page.request.delete(`/api/cart/items/${item.sku_id}`);
    expect(deleteResponse.ok()).toBe(true);
  }
}

async function selectDealer(page: Page, dealerName: string) {
  const trigger = page.locator('button[role="combobox"]').first();
  await trigger.click();
  await page.getByRole("option", { name: dealerName }).click();
}

async function seedCartForOrderSubmit(page: Page, customerId: string) {
  await expectEnvelope(
    await page.request.post("/api/cart/items", {
      data: {
        customerId,
        sku_id: "cb_weijixian_500",
        qty: 2,
        source: "manual",
      },
    }),
  );
}

async function seedCopilotRunViaApi(page: Page, customerId: string) {
  const autofillPayload = await expectEnvelope<CopilotAutofillApiResponse>(
    await page.request.post("/api/copilot/autofill", {
      data: {
        customerId,
        message: "帮我按活动和常购做一单，保守一点",
        pageName: "/purchase",
      },
    }),
  );

  if (autofillPayload.data.draft.status === "preview") {
    await expectEnvelope(
      await page.request.post(
        `/api/copilot/drafts/${encodeURIComponent(autofillPayload.data.draft.draft_id)}/apply`,
        {
          data: {
            customerId,
          },
        },
      ),
    );
  }

  return autofillPayload.data.run.run_id;
}

test.describe.configure({ mode: "serial" });

test("Copilot /purchase keeps preview-first apply flow then goes to /order-submit", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);

  await page.goto("/purchase");
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await selectDealer(page, dealer.customer_name);

  const cartBeforePreview = await fetchCart(page);

  await page.getByRole("button", { name: "打开 Copilot 助手" }).click();
  await expect(page.getByRole("button", { name: "一键做单" })).toBeVisible();

  await page.getByRole("button", { name: "一键做单" }).click();
  await expect(page.getByText("AutofillProgressCard")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("已生成预览草稿，请确认后再写入采购清单。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("预览中（未写车）")).toBeVisible();

  const cartAfterPreview = await fetchCart(page);
  expect(cartAfterPreview.summary.item_count).toBe(cartBeforePreview.summary.item_count);
  expect(cartAfterPreview.summary.total_amount).toBe(cartBeforePreview.summary.total_amount);

  await page.getByRole("button", { name: "确认应用到采购清单" }).click();
  await expect(page.getByText("已写入采购清单并执行凑单优化，可继续前往结算。")).toBeVisible({
    timeout: 30_000,
  });

  const cartAfterApply = await fetchCart(page);
  expect(cartAfterApply.summary.item_count).toBeGreaterThan(cartAfterPreview.summary.item_count);
  expect(cartAfterApply.summary.total_amount).toBeGreaterThan(
    cartAfterPreview.summary.total_amount,
  );

  await page.getByRole("link", { name: "去结算页继续提交" }).click();
  await expect(page).toHaveURL(/\/order-submit$/);
});

test("Copilot /order-submit behaves as closeout helper and keeps preview-first semantics", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);
  await seedCartForOrderSubmit(page, dealer.customer_id);

  await page.goto("/order-submit");
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();

  await page.getByRole("button", { name: "打开 Copilot 助手" }).click();
  await expect(page.getByText("仅支持解释优化、继续安全补齐和去提交。")).toBeVisible();
  await expect(page.getByRole("button", { name: "一键做单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "活动补齐" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解释当前优化" })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续安全补齐" })).toBeVisible();

  const cartBeforePreview = await fetchCart(page);
  await page.getByRole("button", { name: "继续安全补齐" }).click();
  await expect(page.getByText("AutofillProgressCard")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("已生成补齐预览，确认后才会写入购物车。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("预览中（未写车）")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认应用到购物车" })).toBeVisible();

  const cartAfterPreview = await fetchCart(page);
  expect(cartAfterPreview.summary.item_count).toBe(cartBeforePreview.summary.item_count);
  expect(cartAfterPreview.summary.total_amount).toBe(cartBeforePreview.summary.total_amount);

  let optimizeAfterApplyCount = 0;
  const requestListener = (request: Request) => {
    if (request.method() === "POST" && request.url().includes("/api/cart-optimize")) {
      optimizeAfterApplyCount += 1;
    }
  };
  page.on("request", requestListener);

  await page.getByRole("button", { name: "确认应用到购物车" }).click();
  await expect(page.getByText("已写入购物车并同步最新结算优化，可继续提交订单。")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  page.off("request", requestListener);
  expect(optimizeAfterApplyCount).toBe(0);
});

test("Admin pages expose Copilot KPI, visibility slices, and traces affordance", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);
  const seededRunId = await seedCopilotRunViaApi(page, dealer.customer_id);

  await page.goto("/admin/analytics/overview");
  await expect(page).toHaveURL(/\/admin\/analytics\/overview$/);
  await expect(page.getByText("Copilot 核心指标（最小集）")).toBeVisible();
  await expect(page.getByText("Copilot 使用次数")).toBeVisible();
  await expect(page.getByText("一键做单发起数")).toBeVisible();

  await page.goto("/admin/analytics/recommendation-records");
  await expect(page).toHaveURL(/\/admin\/analytics\/recommendation-records$/);
  await expect(page.getByText("Copilot 运行视角")).toBeVisible();
  await page.getByRole("button", { name: "刷新 Copilot 视图" }).click();

  const copilotEmptyHint = page.getByText("当前筛选下暂无 Copilot 运行记录。");
  if ((await copilotEmptyHint.count()) > 0) {
    await expect(copilotEmptyHint).toBeVisible();
  } else {
    await expect(page.getByText(seededRunId)).toBeVisible();
  }

  await page.goto("/admin/observability/traces");
  await expect(page).toHaveURL(/\/admin\/observability\/traces$/);
  await expect(
    page.locator('[data-slot="card-title"]', { hasText: /^Copilot 链路$/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "刷新 Copilot" }).click();

  const copilotTraceEmpty = page.getByText("暂无 Copilot 链路");
  if ((await copilotTraceEmpty.count()) > 0) {
    await expect(copilotTraceEmpty).toBeVisible();
    return;
  }

  const seededRow = page.locator("tbody tr", { hasText: seededRunId }).first();
  await expect(seededRow).toBeVisible();

  const rowLangfuseLink = seededRow.getByRole("link", { name: "Langfuse" });
  if ((await rowLangfuseLink.count()) > 0) {
    await expect(rowLangfuseLink).toBeVisible();
  } else {
    await expect(seededRow.getByText("不可用")).toBeVisible();
  }

  await seededRow.click();
  const detailLangfuseLink = page.getByRole("link", { name: "在 Langfuse 打开链路" });
  if ((await detailLangfuseLink.count()) > 0) {
    await expect(detailLangfuseLink).toBeVisible();
  } else {
    await expect(page.getByText("未配置 Langfuse 链路入口")).toBeVisible();
  }
});
