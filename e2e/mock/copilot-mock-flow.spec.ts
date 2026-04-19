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
    input_mode?: "text" | "image" | "mixed";
  };
  draft: {
    draft_id: string;
    status: "preview" | "applied" | "blocked";
  };
};

type CopilotOverviewApiResponse = {
  total: number;
  rows: Array<{
    run: {
      run_id: string;
      run_type: "autofill_order" | "explain_order";
      page_name: "/purchase" | "/order-submit";
      customer_id: string;
    };
  }>;
};

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAukB9VE3d2kAAAAASUVORK5CYII=",
  "base64",
);

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

async function fetchCopilotOverview(page: Page, searchParams: URLSearchParams) {
  const overviewPayload = await expectEnvelope<CopilotOverviewApiResponse>(
    await page.request.get(`/api/admin/copilot/overview?${searchParams.toString()}`),
  );
  return overviewPayload.data;
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

function getLastUserMessageText(raw: unknown) {
  if (!Array.isArray(raw)) {
    return "";
  }

  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") {
      continue;
    }

    const message = item as Record<string, unknown>;
    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content.trim();
    }

    if (Array.isArray(message.parts)) {
      const text = message.parts
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const current = part as Record<string, unknown>;
          return current.type === "text" && typeof current.text === "string" ? current.text : "";
        })
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const current = part as Record<string, unknown>;
          return current.type === "text" && typeof current.text === "string" ? current.text : "";
        })
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

async function captureCopilotChatCall(
  page: Page,
  trigger: () => Promise<void> | void,
) {
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/api/copilot/chat"),
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/copilot/chat"),
  );

  await trigger();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.ok()).toBe(true);

  return {
    requestBody: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    response,
  };
}

async function captureCopilotAutofillCall(
  page: Page,
  trigger: () => Promise<void> | void,
) {
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/api/copilot/autofill"),
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/copilot/autofill"),
  );

  await trigger();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  const payload = await expectEnvelope<CopilotAutofillApiResponse>(response);
  return {
    requestBody: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    payload: payload.data,
  };
}

async function uploadMockImages(page: Page, names: string[]) {
  await page.locator('input[type="file"]').setInputFiles(
    names.map((name) => ({
      name,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
}

test.describe.configure({ mode: "serial" });

test("/purchase AI assistant clickable surface covers actions, image preview, and apply flow", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);

  await page.goto("/purchase");
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await selectDealer(page, dealer.customer_name);

  const openPurchasePanel = async () => {
    await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
    const panel = page.locator("aside").last();
    await expect(panel.getByRole("button", { name: "一键做单" })).toBeVisible();
    return panel;
  };

  const cartBeforePreview = await fetchCart(page);

  let purchasePanel = await openPurchasePanel();
  await page.getByRole("button", { name: "关闭 AI 下单助手" }).last().click();
  await expect(page.getByRole("button", { name: "一键做单" })).toHaveCount(0);
  purchasePanel = await openPurchasePanel();

  await expect(purchasePanel.getByRole("button", { name: "查看模板" })).toBeVisible();
  await expect(purchasePanel.getByRole("button", { name: "查看活动" }).first()).toBeVisible();
  await purchasePanel.getByRole("button", { name: "查看模板" }).click();
  purchasePanel = await openPurchasePanel();
  await expect(purchasePanel.getByRole("button", { name: "查看活动" }).first()).toBeVisible();
  await purchasePanel.getByRole("button", { name: "查看活动" }).first().click();
  purchasePanel = await openPurchasePanel();

  const quickChips = ["预算 6000 左右", "优先活动", "不要新品", "只补常购", "保守一点"];
  const purchaseInput = purchasePanel.getByPlaceholder("比如：预算 6000，优先活动，不要新品");
  for (const chip of quickChips) {
    await purchasePanel.getByRole("button", { name: chip }).click();
  }
  await expect(purchaseInput).toHaveValue(/预算 6000 左右/);
  await expect(purchaseInput).toHaveValue(/优先活动/);
  await expect(purchaseInput).toHaveValue(/不要新品/);
  await expect(purchaseInput).toHaveValue(/只补常购/);
  await expect(purchaseInput).toHaveValue(/保守一点/);

  await expect(purchasePanel.getByRole("button", { name: "上传图片" })).toBeVisible();
  await expect(purchasePanel.getByRole("button", { name: "粘贴截图" })).toBeVisible();
  await purchasePanel.getByRole("button", { name: "粘贴截图" }).click();
  await expect(page.getByText("请在输入框中使用 Ctrl/Cmd + V 粘贴截图。")).toBeVisible();

  await uploadMockImages(page, ["进货单-A.png", "进货单-B.png"]);
  await expect(purchasePanel.getByRole("button", { name: "预览图片 进货单-A.png" })).toBeVisible();
  await expect(purchasePanel.getByRole("button", { name: "预览图片 进货单-B.png" })).toBeVisible();

  await purchasePanel.getByRole("button", { name: "预览图片 进货单-A.png" }).click();
  await expect(page.getByText("图片预览")).toBeVisible();
  await expect(page.getByText("进货单-A.png · 1/2")).toBeVisible();
  await page.getByRole("button", { name: "下一张图片" }).click();
  await expect(page.getByText("进货单-B.png · 2/2")).toBeVisible();
  await page.getByRole("button", { name: "上一张图片" }).click();
  await expect(page.getByText("进货单-A.png · 1/2")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览" }).last().click();
  await expect(page.getByText("图片预览")).toHaveCount(0);

  await purchasePanel.getByRole("button", { name: "预览图片 进货单-A.png" }).click();
  await page.getByRole("button", { name: "关闭图片预览" }).first().dispatchEvent("click");
  if ((await page.getByText("图片预览").count()) > 0) {
    await page.getByRole("button", { name: "关闭图片预览" }).last().click();
  }
  await expect(page.getByText("图片预览")).toHaveCount(0);

  await purchasePanel.getByRole("button", { name: "预览图片 进货单-A.png" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("图片预览")).toHaveCount(0);

  await expect(purchasePanel.getByRole("button", { name: "解释这单" })).toBeVisible();
  await purchasePanel.getByRole("button", { name: "解释这单" }).click();

  await purchaseInput.fill("按常购和活动做一单，预算控制在 6000 左右。");
  const topupCall = await captureCopilotAutofillCall(page, async () => {
    await purchasePanel.getByRole("button", { name: "活动补齐" }).click();
  });
  expect(topupCall.requestBody.pageName).toBe("/purchase");
  expect(Array.isArray(topupCall.requestBody.images)).toBe(true);
  expect((topupCall.requestBody.images as unknown[]).length).toBe(2);
  await expect(page.getByText("已生成采购预览，可确认后加入采购清单。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(purchasePanel.getByRole("button", { name: "查看识别内容" })).toBeVisible();
  await purchasePanel.getByRole("button", { name: "查看识别内容" }).click();
  await expect(page.getByRole("button", { name: "关闭识别内容" }).last()).toBeVisible();
  await page.getByRole("button", { name: "关闭识别内容" }).last().click();
  await expect(page.getByRole("button", { name: "关闭识别内容" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await selectDealer(page, dealer.customer_name);
  purchasePanel = await openPurchasePanel();

  const cleanPurchaseInput = purchasePanel.getByPlaceholder("比如：预算 6000，优先活动，不要新品");
  await cleanPurchaseInput.fill("按常购和活动做一单，预算控制在 6000 左右。");
  const autofillCall = await captureCopilotAutofillCall(page, async () => {
    await purchasePanel.getByRole("button", { name: "一键做单" }).click();
  });
  expect(autofillCall.requestBody.pageName).toBe("/purchase");
  expect(Array.isArray(autofillCall.requestBody.images)).toBe(true);
  expect((autofillCall.requestBody.images as unknown[]).length).toBe(0);
  await expect(page.getByText("已生成采购预览，可确认后加入采购清单。")).toBeVisible({
    timeout: 30_000,
  });
  if ((await purchasePanel.getByRole("button", { name: "加入采购清单" }).count()) === 0) {
    await cleanPurchaseInput.fill("按常购做一单");
    await captureCopilotAutofillCall(page, async () => {
      await purchasePanel.getByRole("button", { name: "一键做单" }).click();
    });
    await expect(page.getByText("已生成采购预览，可确认后加入采购清单。")).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(purchasePanel.getByRole("button", { name: "继续调整" })).toBeVisible();
  await purchasePanel.getByRole("button", { name: "继续调整" }).click();
  await expect(cleanPurchaseInput).toBeFocused();
  await expect(purchasePanel.getByRole("link", { name: "去结算", exact: true })).toBeVisible();
  await expect(purchasePanel.getByRole("button", { name: "加入采购清单" })).toBeVisible();

  const cartAfterPreview = await fetchCart(page);
  expect(cartAfterPreview.summary.item_count).toBe(cartBeforePreview.summary.item_count);
  expect(cartAfterPreview.summary.total_amount).toBe(cartBeforePreview.summary.total_amount);

  await purchasePanel.getByRole("button", { name: "加入采购清单" }).click();
  await expect(page.getByText("已加入采购清单，可继续调整或去结算。")).toBeVisible({
    timeout: 30_000,
  });

  const cartAfterApply = await fetchCart(page);
  expect(cartAfterApply.summary.item_count).toBeGreaterThan(cartAfterPreview.summary.item_count);
  expect(cartAfterApply.summary.total_amount).toBeGreaterThan(
    cartAfterPreview.summary.total_amount,
  );

  await purchasePanel
    .locator('a[href="/order-submit"]')
    .filter({ hasText: /^去结算$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/order-submit$/);
});

test("/order-submit AI assistant keeps closeout actions and excludes image upload/preview", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);
  await seedCartForOrderSubmit(page, dealer.customer_id);

  await page.goto("/order-submit");
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();

  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByText("仅支持解释当前优化、继续安全补齐和去提交。")).toBeVisible();
  await expect(page.getByRole("button", { name: "一键做单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "活动补齐" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解释当前优化" })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续安全补齐" })).toBeVisible();
  await expect(page.getByRole("button", { name: "去提交" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传图片" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "粘贴截图" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看识别内容" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上一张图片" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下一张图片" })).toHaveCount(0);

  await page
    .getByPlaceholder("例如：解释当前推荐，或继续安全补齐活动门槛")
    .fill("解释当前优化建议对门槛、箱规和提交风险的影响。");
  await page.getByRole("button", { name: "解释当前优化" }).click();

  await page
    .getByPlaceholder("例如：解释当前推荐，或继续安全补齐活动门槛")
    .fill("继续安全补齐活动门槛，控制风险，不要激进扩单。");

  const cartBeforePreview = await fetchCart(page);
  const safeTopup = await captureCopilotAutofillCall(page, async () => {
    await page.getByRole("button", { name: "继续安全补齐" }).click();
  });
  expect(safeTopup.requestBody.pageName).toBe("/order-submit");
  await expect(page.getByText("已生成补齐预览，确认后才会加入当前清单。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("预览中（未写车）")).toBeVisible();
  await expect(page.getByRole("button", { name: "加入当前清单" })).toBeVisible();

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

  await page.getByRole("button", { name: "加入当前清单" }).click();
  await expect(page.getByText("已加入当前清单并同步最新结算优化，可继续提交订单。")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  page.off("request", requestListener);
  expect(optimizeAfterApplyCount).toBe(0);

  await page.getByRole("button", { name: "关闭 Copilot 面板" }).last().click();
  await expect(page.getByRole("button", { name: "解释当前优化" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByRole("button", { name: "解释当前优化" })).toBeVisible();
});

test("Copilot /purchase chat covers quick explain and manual composer send with only LLM mocked", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);

  await page.goto("/purchase");
  await expect(page).toHaveURL(/\/purchase$/);
  await expect(page.getByTestId("purchase-workbench")).toBeVisible();
  await selectDealer(page, dealer.customer_name);

  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByRole("button", { name: "解释这单" })).toBeVisible();
  const quickQuestion = "解释这单当前门槛状态和推荐依据。";
  await page
    .getByPlaceholder("比如：预算 6000，优先活动，不要新品")
    .fill(quickQuestion);

  const quickExplain = await captureCopilotChatCall(page, async () => {
    await page.getByRole("button", { name: "解释这单" }).click();
  });
  expect(quickExplain.requestBody.customerId).toBe(dealer.customer_id);
  expect(quickExplain.requestBody.pageName).toBe("/purchase");
  expect(getLastUserMessageText(quickExplain.requestBody.messages)).toBe(quickQuestion);
  expect(quickExplain.requestBody.message).toBeUndefined();

  const quickExplainRunId = (await quickExplain.response.headerValue("x-copilot-run-id")) ?? "";
  expect(quickExplainRunId).not.toBe("");

  await expect(page.getByText(quickQuestion)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("当前没有可直接应用的安全组合，请调整约束后重试。")).toBeVisible({
    timeout: 30_000,
  });

  const manualMessage = "预算 6000，优先活动，解释为什么这样推荐。";
  await page
    .getByPlaceholder("比如：预算 6000，优先活动，不要新品")
    .fill(manualMessage);

  const manualExplain = await captureCopilotChatCall(page, async () => {
    await page.getByRole("button", { name: "发送" }).click();
  });
  expect(manualExplain.requestBody.customerId).toBe(dealer.customer_id);
  expect(manualExplain.requestBody.pageName).toBe("/purchase");
  expect(getLastUserMessageText(manualExplain.requestBody.messages)).toBe(manualMessage);

  const manualExplainRunId = (await manualExplain.response.headerValue("x-copilot-run-id")) ?? "";
  expect(manualExplainRunId).not.toBe("");

  await expect(page.getByText(manualMessage)).toBeVisible({ timeout: 30_000 });

  const overview = await fetchCopilotOverview(
    page,
    new URLSearchParams({
      customerId: dealer.customer_id,
      pageName: "/purchase",
      runType: "explain_order",
      limit: "20",
    }),
  );
  expect(overview.rows.map((row) => row.run.run_id)).toEqual(
    expect.arrayContaining([quickExplainRunId, manualExplainRunId]),
  );
});

test("Copilot /order-submit chat covers quick explain and manual composer send with only LLM mocked", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);
  await seedCartForOrderSubmit(page, dealer.customer_id);

  await page.goto("/order-submit");
  await expect(page).toHaveURL(/\/order-submit$/);
  await expect(page.getByTestId("order-submit-workbench")).toBeVisible();

  await page.getByRole("button", { name: "打开 AI 下单助手" }).click();
  await expect(page.getByRole("button", { name: "解释当前优化" })).toBeVisible();
  const quickQuestion = "解释当前优化建议对门槛、箱规和提交风险的影响。";
  await page
    .getByPlaceholder("例如：解释当前推荐，或继续安全补齐活动门槛")
    .fill(quickQuestion);

  const quickExplain = await captureCopilotChatCall(page, async () => {
    await page.getByRole("button", { name: "解释当前优化" }).click();
  });
  expect(quickExplain.requestBody.customerId).toBe(dealer.customer_id);
  expect(quickExplain.requestBody.pageName).toBe("/order-submit");
  expect(getLastUserMessageText(quickExplain.requestBody.messages)).toBe(quickQuestion);
  expect(quickExplain.requestBody.message).toBeUndefined();

  const quickExplainRunId = (await quickExplain.response.headerValue("x-copilot-run-id")) ?? "";
  expect(quickExplainRunId).not.toBe("");

  await expect(page.getByText(quickQuestion)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("当前没有可直接应用的安全组合，请调整约束后重试。")).toBeVisible({
    timeout: 30_000,
  });

  const manualMessage = "解释当前推荐，并保持补齐策略保守。";
  await page
    .getByPlaceholder("例如：解释当前推荐，或继续安全补齐活动门槛")
    .fill(manualMessage);

  const manualExplain = await captureCopilotChatCall(page, async () => {
    await page.getByRole("button", { name: "发送" }).click();
  });
  expect(manualExplain.requestBody.customerId).toBe(dealer.customer_id);
  expect(manualExplain.requestBody.pageName).toBe("/order-submit");
  expect(getLastUserMessageText(manualExplain.requestBody.messages)).toBe(manualMessage);

  const manualExplainRunId = (await manualExplain.response.headerValue("x-copilot-run-id")) ?? "";
  expect(manualExplainRunId).not.toBe("");

  await expect(page.getByText(manualMessage)).toBeVisible({ timeout: 30_000 });

  const overview = await fetchCopilotOverview(
    page,
    new URLSearchParams({
      customerId: dealer.customer_id,
      pageName: "/order-submit",
      runType: "explain_order",
      limit: "20",
    }),
  );
  expect(overview.rows.map((row) => row.run.run_id)).toEqual(
    expect.arrayContaining([quickExplainRunId, manualExplainRunId]),
  );
});

test("Admin pages expose AI assistant KPI, visibility slices, and traces affordance", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const dealer = await fetchActiveDealer(page);
  await clearCart(page);
  const seededRunId = await seedCopilotRunViaApi(page, dealer.customer_id);

  await page.goto("/admin/analytics/overview");
  await expect(page).toHaveURL(/\/admin\/analytics\/overview$/);
  await expect(page.getByText("AI 下单助手核心指标（最小集）")).toBeVisible();
  await expect(page.getByText("AI 助手触发次数")).toBeVisible();
  await expect(page.getByText("一键做单发起数")).toBeVisible();

  await page.goto("/admin/analytics/recommendation-records");
  await expect(page).toHaveURL(/\/admin\/analytics\/recommendation-records$/);
  await expect(page.getByText("AI 下单助手运行视角")).toBeVisible();
  await page.getByRole("button", { name: "刷新 AI 助手视图" }).click();

  const copilotEmptyHint = page.getByText("当前筛选下暂无 AI 助手运行记录。");
  if ((await copilotEmptyHint.count()) > 0) {
    await expect(copilotEmptyHint).toBeVisible();
  } else {
    await expect(page.getByText(seededRunId)).toBeVisible();
  }

  await page.goto("/admin/observability/traces");
  await expect(page).toHaveURL(/\/admin\/observability\/traces$/);
  await expect(
    page.locator('[data-slot="card-title"]', { hasText: /^AI 下单助手链路$/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "刷新 AI 助手" }).click();

  const copilotTraceEmpty = page.getByText("暂无 AI 助手链路");
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
