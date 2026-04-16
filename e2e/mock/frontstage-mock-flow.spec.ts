import { expect, test } from "@playwright/test";

type ApiEnvelope<TData> = {
  success: boolean;
  data: TData;
};

type PromptConfigResponse = {
  global_style: {
    tone: string;
    avoid: string[];
    reason_limit: number;
  };
  recommendation_prompt: {
    system_role: string;
    instruction: string;
  };
  cart_opt_prompt: {
    system_role: string;
    instruction: string;
  };
  explain_prompt: {
    system_role: string;
    instruction: string;
  };
};

type RecommendationsResponse = {
  summary: {
    daily_run_id: string;
  };
};

type RecommendationRunDetailResponse = {
  run: {
    prompt_snapshot: string;
  };
};

test.describe.configure({ mode: "serial" });

test("mock B2B procurement flow uses canonical IA and keeps records queryable in admin", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/procurement$/);
  await expect(page.getByTestId("procurement-home")).toBeVisible();

  await page.getByRole("button", { name: "刷新采购建议" }).click();
  await expect(page.getByText("采购建议已刷新，可直接查看原因并加入采购清单。")).toBeVisible();

  const replenishmentModule = page.getByTestId("replenishment-module");
  await expect(replenishmentModule).toBeVisible();
  await replenishmentModule.getByRole("button", { name: "加入采购清单" }).first().click();
  await expect(page.getByText(/已加入采购清单：/)).toBeVisible();

  await page.getByRole("button", { name: "一键加入建议" }).click();
  await expect(page.getByText(/已批量加入 \d+ 条采购建议。/)).toBeVisible();

  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/catalog$/);
  const catalogGrid = page.getByTestId("catalog-grid");
  await expect(catalogGrid).toBeVisible();
  await catalogGrid.getByRole("button", { name: "加入采购清单" }).first().click();
  await expect(page.getByText(/已加入：/)).toBeVisible();

  await page.getByRole("link", { name: "去采购清单" }).click();
  await expect(page).toHaveURL(/\/basket$/);
  await expect(page.getByTestId("basket-summary")).toBeVisible();
  await expect(page.getByTestId("basket-optimization-panel")).toBeVisible();

  await page.getByRole("button", { name: "生成优化建议" }).click();
  await expect(page.getByText("已生成订单优化建议。")).toBeVisible();
  await page.getByRole("button", { name: "一键应用全部" }).click();
  await expect(page.getByText("已批量应用本次订单优化建议。")).toBeVisible();

  await page.getByRole("link", { name: "去下单确认" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("checkout-summary")).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/workbench\/overview$/);
  await expect(page.getByTestId("admin-primary-nav")).toBeVisible();
  await expect(page.getByTestId("admin-workbench-kpis")).toBeVisible();

  await page.getByRole("link", { name: "数据与分析" }).click();
  await expect(page).toHaveURL(/\/admin\/analytics\/overview$/);
  await expect(page.getByTestId("admin-secondary-nav")).toBeVisible();

  await page.getByTestId("admin-secondary-nav").getByRole("link", { name: "推荐记录" }).click();
  await expect(page).toHaveURL(/\/admin\/analytics\/recommendations$/);
  await expect(page.getByTestId("recommendation-report-table")).toBeVisible();

  const recordRows = page.locator('[data-testid="recommendation-report-table"] tbody tr');
  await expect(recordRows.first()).not.toContainText("无数据");
  await recordRows.first().click();
  await expect(page.getByTestId("trace-link")).toBeVisible();

  await page.getByRole("link", { name: "前往链路观察" }).click();
  await expect(page).toHaveURL(/\/admin\/observability\/traces$/);
  await page.locator("tbody tr").first().click();
  await expect(page.getByTestId("trace-link")).toBeVisible();
});

test("mock admin prompt changes propagate into recommendation prompt snapshots", async ({
  page,
}) => {
  const promptResponse = await page.request.get("/api/admin/prompts");
  expect(promptResponse.ok()).toBe(true);
  const originalPrompts = (await promptResponse.json()) as ApiEnvelope<PromptConfigResponse>;
  expect(originalPrompts.success).toBe(true);

  const marker = `MOCK_PROMPT_MARKER_${Date.now()}`;
  const updatedPrompts: PromptConfigResponse = {
    ...originalPrompts.data,
    recommendation_prompt: {
      ...originalPrompts.data.recommendation_prompt,
      instruction: `${originalPrompts.data.recommendation_prompt.instruction}\n${marker}`,
    },
  };

  try {
    const patchResponse = await page.request.patch("/api/admin/prompts", {
      data: updatedPrompts,
    });
    expect(patchResponse.ok()).toBe(true);

    await page.goto("/procurement");
    const recommendationsPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/recommendations"),
    );
    await page.getByRole("button", { name: "刷新采购建议" }).click();
    const recommendationsPayload = (await (
      await recommendationsPromise
    ).json()) as ApiEnvelope<RecommendationsResponse>;
    expect(recommendationsPayload.success).toBe(true);

    const detailResponse = await page.request.get(
      `/api/admin/reports/recommendations/${recommendationsPayload.data.summary.daily_run_id}`,
    );
    expect(detailResponse.ok()).toBe(true);
    const detailPayload =
      (await detailResponse.json()) as ApiEnvelope<RecommendationRunDetailResponse>;
    expect(detailPayload.success).toBe(true);
    expect(detailPayload.data.run.prompt_snapshot).toContain(marker);
  } finally {
    await page.request.patch("/api/admin/prompts", {
      data: originalPrompts.data,
    });
  }
});
