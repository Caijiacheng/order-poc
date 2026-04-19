import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function expectTestIdContract(source: string, testId: string) {
  const escaped = escapeRegExp(testId);
  const directPattern = new RegExp(
    `(?:data-testid|testId)\\s*=\\s*["']${escaped}["']`,
  );
  const expressionPattern = new RegExp(
    `(?:data-testid|testId)\\s*=\\s*\\{[^}]*["']${escaped}["'][^}]*\\}`,
  );
  expect(directPattern.test(source) || expressionPattern.test(source)).toBe(true);
}

function expectPublishedSuggestionReadonlyContract(source: string) {
  expect(source).toMatch(/\bfetchPublishedSuggestions\b/);
  expect(source).not.toMatch(/\bcreateRecommendations\b/);
}

describe("frontstage canonical source contract", () => {
  it("keeps canonical purchase/order-submit page ids", () => {
    const purchaseSource = readSource("app/(frontstage)/purchase/page.tsx");
    expectTestIdContract(purchaseSource, "purchase-workbench");
    expectTestIdContract(purchaseSource, "purchase-bundle-templates");
    expectTestIdContract(purchaseSource, "purchase-activity-zone");
    expectTestIdContract(purchaseSource, "purchase-catalog-zone");
    expectTestIdContract(purchaseSource, "purchase-procurement-summary");

    const orderSubmitSource = readSource("app/(frontstage)/order-submit/page.tsx");
    expectTestIdContract(orderSubmitSource, "order-submit-workbench");
    expectTestIdContract(orderSubmitSource, "order-submit-recommendation-bars");
    expectTestIdContract(orderSubmitSource, "order-submit-summary");
  });

  it("keeps /purchase on published-suggestions readonly contract", () => {
    const purchaseSource = readSource("app/(frontstage)/purchase/page.tsx");
    expectPublishedSuggestionReadonlyContract(purchaseSource);
    expect(purchaseSource).toMatch(/\bfetchPublishedSuggestions\s*\(/);
    expect(purchaseSource).toMatch(/快速下单/);
    expect(purchaseSource).toMatch(/活动专区/);
    expect(purchaseSource).toMatch(/商品选购区/);
    expect(purchaseSource).toMatch(/采购摘要/);
    expect(purchaseSource).not.toMatch(/今日建议单/);
    expect(purchaseSource).not.toMatch(/常购快捷补货/);
    expect(purchaseSource).not.toMatch(/一键复购/);
    expect(purchaseSource).not.toMatch(/采纳\/改量/);
    expect(purchaseSource).not.toMatch(/忽略/);
    expect(purchaseSource).toMatch(/查看详情/);
    expect(purchaseSource).toMatch(/purchase-reason-drawer/);
    expect(purchaseSource).toMatch(/本页建议摘要/);
    expect(purchaseSource).toMatch(/去结算/);
    expect(purchaseSource).not.toMatch(/生成建议/);

    const frontstageApiSource = readSource("lib/frontstage/api.ts");
    expect(frontstageApiSource).toMatch(
      /\/api\/frontstage\/published-suggestions\?customerId=/,
    );
    expect(frontstageApiSource).toMatch(/\bbundleTemplates\b/);
    expect(frontstageApiSource).toMatch(/\bactivityHighlights\b/);
    expect(frontstageApiSource).toMatch(/\bcartSummary\b/);
  });

  it("keeps /order-submit recommendation-bar contract without legacy optimization panel", () => {
    const orderSubmitSource = readSource("app/(frontstage)/order-submit/page.tsx");
    expect(orderSubmitSource).toMatch(/\boptimizeCart\b/);
    expect(orderSubmitSource).toMatch(/凑单推荐/);
    expect(orderSubmitSource).toMatch(/查看依据/);
    expect(orderSubmitSource).toMatch(/order-submit-reason-drawer/);
    expect(orderSubmitSource).toMatch(/recommendationBars/);
    expect(orderSubmitSource).not.toMatch(/生成优化建议/);
    expect(orderSubmitSource).not.toMatch(/一键应用全部/);
  });

  it("locks AI assistant wording and purchase/order-submit copilot interaction contract", () => {
    const purchaseCopilotSource = readSource(
      "components/frontstage/copilot/purchase-copilot-panel.tsx",
    );
    expect(purchaseCopilotSource).toMatch(/打开 AI 下单助手/);
    expect(purchaseCopilotSource).toMatch(/查看模板/);
    expect(purchaseCopilotSource).toMatch(/查看活动/);
    expect(purchaseCopilotSource).toMatch(/一键做单/);
    expect(purchaseCopilotSource).toMatch(/活动补齐/);
    expect(purchaseCopilotSource).toMatch(/解释这单/);
    expect(purchaseCopilotSource).toMatch(/上传图片/);
    expect(purchaseCopilotSource).toMatch(/粘贴截图/);
    expect(purchaseCopilotSource).toMatch(/查看识别内容/);
    expect(purchaseCopilotSource).toMatch(/停止/);
    expect(purchaseCopilotSource).toMatch(/发送/);
    expect(purchaseCopilotSource).toMatch(/加入采购清单/);
    expect(purchaseCopilotSource).toMatch(/继续调整/);
    expect(purchaseCopilotSource).toMatch(/去结算/);
    expect(purchaseCopilotSource).not.toMatch(/打开 Copilot 助手/);
    expect(purchaseCopilotSource).not.toMatch(/AutofillProgressCard/);
    expect(purchaseCopilotSource).not.toMatch(/AutofillResultCard/);

    const orderSubmitCopilotSource = readSource(
      "components/frontstage/copilot/order-submit-copilot-panel.tsx",
    );
    expect(orderSubmitCopilotSource).toMatch(/打开 AI 下单助手/);
    expect(orderSubmitCopilotSource).toMatch(/解释当前优化/);
    expect(orderSubmitCopilotSource).toMatch(/继续安全补齐/);
    expect(orderSubmitCopilotSource).toMatch(/去提交/);
    expect(orderSubmitCopilotSource).not.toMatch(/上传图片/);
    expect(orderSubmitCopilotSource).not.toMatch(/粘贴截图/);
    expect(orderSubmitCopilotSource).not.toMatch(/查看识别内容/);
    expect(orderSubmitCopilotSource).not.toMatch(/图片预览/);
    expect(orderSubmitCopilotSource).not.toMatch(/AutofillProgressCard/);
    expect(orderSubmitCopilotSource).not.toMatch(/AutofillResultCard/);
  });

});

describe("admin canonical source contract", () => {
  it("keeps admin page ids", () => {
    const adminLayoutSource = readSource("app/admin/layout.tsx");
    expectTestIdContract(adminLayoutSource, "admin-primary-nav");
    expectTestIdContract(adminLayoutSource, "admin-secondary-nav");

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/title="运营看板"/);

    const recommendationSource = readSource(
      "app/admin/analytics/recommendation-records/page.tsx",
    );
    expectTestIdContract(recommendationSource, "recommendation-report-table");
    expectTestIdContract(recommendationSource, "trace-link");

    const traceSource = readSource("app/admin/observability/traces/page.tsx");
    expectTestIdContract(traceSource, "trace-link");
  });

  it("locks key CRUD pages to AdminDrawer + AdminConfirmDialog contract", () => {
    const keyPages = [
      "app/admin/master-data/dealers/page.tsx",
      "app/admin/master-data/segments/page.tsx",
      "app/admin/master-data/product-pools/page.tsx",
      "app/admin/strategy/campaigns/page.tsx",
      "app/admin/strategy/recommendation-strategies/page.tsx",
      "app/admin/strategy/expression-templates/page.tsx",
      "app/admin/operations/generation-jobs/page.tsx",
    ] as const;

    for (const pagePath of keyPages) {
      const source = readSource(pagePath);
      expect(source).toMatch(/import\s+\{\s*AdminConfirmDialog\s*\}/);
      expect(source).toMatch(/import\s+\{\s*AdminDrawer\s*\}/);
      expect(source).toMatch(/<AdminDrawer/);
      expect(source).toMatch(/<AdminConfirmDialog/);
      expect(source).toMatch(/setDrawerOpen\(true\)/);
    }
  });

  it("does not expose removed admin route page contracts", () => {
    expect(
      existsSync(path.join(process.cwd(), "app/admin/analytics/recommendations/page.tsx")),
    ).toBe(false);
    expect(
      existsSync(
        path.join(process.cwd(), "app/admin/strategy/recommendation-templates/page.tsx"),
      ),
    ).toBe(false);
    expect(
      existsSync(path.join(process.cwd(), "app/admin/strategy/rules/page.tsx")),
    ).toBe(false);
    expect(
      existsSync(path.join(process.cwd(), "app/admin/strategy/ai-expression/page.tsx")),
    ).toBe(false);
  });
});

describe("admin canonical migration source contract", () => {
  it("locks strategy and analytics pages to canonical APIs", () => {
    const strategiesSource = readSource(
      "app/admin/strategy/recommendation-strategies/page.tsx",
    );
    expect(strategiesSource).toMatch(/\/api\/admin\/recommendation-strategies/);
    expect(strategiesSource).toMatch(/sceneGroup=purchase/);
    expect(strategiesSource).not.toMatch(/SelectItem value="checkout_optimization"/);
    expect(strategiesSource).not.toMatch(/\/api\/admin\/suggestion-templates/);

    const expressionTemplatesSource = readSource(
      "app/admin/strategy/expression-templates/page.tsx",
    );
    expect(expressionTemplatesSource).toMatch(/\/api\/admin\/expression-templates/);
    expect(expressionTemplatesSource).not.toMatch(/\/api\/admin\/prompts/);

    const recommendationRecordsSource = readSource(
      "app/admin/analytics/recommendation-records/page.tsx",
    );
    expect(recommendationRecordsSource).toMatch(/\/api\/admin\/recommendation-records/);
    expect(recommendationRecordsSource).not.toMatch(
      /\/api\/admin\/reports\/recommendations/,
    );

    const traceSource = readSource("app/admin/observability/traces/page.tsx");
    expect(traceSource).toMatch(/\/api\/admin\/recommendation-records/);
    expect(traceSource).not.toMatch(/\/api\/admin\/reports\/recommendations/);
  });

  it("keeps workbench/audit/analytics pages off removed reports endpoints", () => {
    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/\/api\/admin\/recommendation-batches/);
    expect(workbenchSource).toMatch(/\/api\/admin\/recommendation-records/);
    expect(workbenchSource).not.toMatch(/\/api\/admin\/reports\//);

    const auditLogsSource = readSource("app/admin/observability/audit-logs/page.tsx");
    expect(auditLogsSource).toMatch(/\/api\/admin\/audit-logs/);
    expect(auditLogsSource).not.toMatch(/\/api\/admin\/reports\//);

    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(/\/api\/admin\/recommendation-batches/);
    expect(analyticsOverviewSource).toMatch(/\/api\/admin\/recommendation-records/);
    expect(analyticsOverviewSource).not.toMatch(/\/api\/admin\/reports\//);
  });

  it("locks admin AI assistant wording and input-mode filters", () => {
    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(/AI 下单助手核心指标（最小集）/);
    expect(analyticsOverviewSource).toMatch(/AI 助手触发次数/);
    expect(analyticsOverviewSource).toMatch(/一键做单发起数/);
    expect(analyticsOverviewSource).not.toMatch(/Copilot 核心指标（最小集）/);

    const recordsSource = readSource("app/admin/analytics/recommendation-records/page.tsx");
    expect(recordsSource).toMatch(/AI 下单助手运行视角/);
    expect(recordsSource).toMatch(/刷新 AI 助手视图/);
    expect(recordsSource).toMatch(/inputMode:\s*nextFilter\.inputMode === "all" \? "" : nextFilter\.inputMode/);
    expect(recordsSource).not.toMatch(/Copilot 运行视角/);
    expect(recordsSource).not.toMatch(/刷新 Copilot 视图/);

    const tracesSource = readSource("app/admin/observability/traces/page.tsx");
    expect(tracesSource).toMatch(/AI 下单助手链路/);
    expect(tracesSource).toMatch(/刷新 AI 助手/);
    expect(tracesSource).toMatch(/inputMode:\s*copilotInputModeFilter === "all" \? "" : copilotInputModeFilter/);
    expect(tracesSource).not.toMatch(/Copilot 链路/);
    expect(tracesSource).not.toMatch(/刷新 Copilot/);

    const copilotOverviewRouteSource = readSource("app/api/admin/copilot/overview/route.ts");
    expect(copilotOverviewRouteSource).toMatch(/const inputMode = searchParams\.get\("inputMode"\) \?\? ""/);
    expect(copilotOverviewRouteSource).toMatch(/run\.input_mode === inputMode/);
  });

  it("ensures migrated admin pages are not CanonicalRouteShell placeholders", () => {
    const globalRulesSource = readSource("app/admin/strategy/global-rules/page.tsx");
    expect(globalRulesSource).toMatch(/\/api\/admin\/global-rules/);
    expect(globalRulesSource).not.toMatch(/\bCanonicalRouteShell\b/);

    const recommendationBatchesSource = readSource(
      "app/admin/operations/recommendation-batches/page.tsx",
    );
    expect(recommendationBatchesSource).toMatch(/\/api\/admin\/recommendation-batches/);
    expect(recommendationBatchesSource).not.toMatch(/\bCanonicalRouteShell\b/);

    const recoverySource = readSource("app/admin/observability/recovery/page.tsx");
    expect(recoverySource).toMatch(/\/api\/admin\/recovery/);
    expect(recoverySource).not.toMatch(/\bCanonicalRouteShell\b/);
  });

  it("keeps canonical /api/admin/audit-logs route and page usage", () => {
    const routePath = path.join(process.cwd(), "app/api/admin/audit-logs/route.ts");
    expect(existsSync(routePath)).toBe(true);

    const routeSource = readSource("app/api/admin/audit-logs/route.ts");
    expect(routeSource).toMatch(/\blistAuditLogs\b/);
    expect(routeSource).toMatch(/\bparseListQuery\b/);

    const auditLogsSource = readSource("app/admin/observability/audit-logs/page.tsx");
    expect(auditLogsSource).toMatch(/\/api\/admin\/audit-logs/);
  });

  it("locks purchase-vs-checkout split semantics for records API and analytics pages", () => {
    const recordsRouteSource = readSource("app/api/admin/recommendation-records/route.ts");
    expect(recordsRouteSource).toMatch(/surface:\s*searchParams\.get\("surface"\)/);
    expect(recordsRouteSource).toMatch(
      /generationMode:\s*searchParams\.get\("generationMode"\)/,
    );

    const recordsPageSource = readSource("app/admin/analytics/recommendation-records/page.tsx");
    expect(recordsPageSource).toMatch(/surface:\s*"purchase"/);
    expect(recordsPageSource).toMatch(/generationMode:\s*"precomputed"/);
    expect(recordsPageSource).toMatch(/surface:\s*"checkout"/);
    expect(recordsPageSource).toMatch(/generationMode:\s*"realtime"/);
    expect(recordsPageSource).toMatch(/params\.set\("surface",\s*VIEW_CONFIG\[view\]\.surface\)/);
    expect(recordsPageSource).toMatch(
      /params\.set\("generationMode",\s*VIEW_CONFIG\[view\]\.generationMode\)/,
    );

    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(
      /item\.surface === "purchase" && item\.generation_mode === "precomputed"/,
    );
    expect(analyticsOverviewSource).toMatch(
      /item\.surface === "checkout" && item\.generation_mode === "realtime"/,
    );

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(
      /item\.surface === "purchase" && item\.generation_mode === "precomputed"/,
    );
    expect(workbenchSource).toMatch(
      /item\.surface === "checkout" && item\.generation_mode === "realtime"/,
    );
  });

  it("locks Stage 5 snapshot command wiring and seed purchase snapshot truth source", () => {
    const packageJson = JSON.parse(readSource("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["demo:prepare-snapshots"]).toContain(
      "scripts/prepare-snapshots.ts",
    );

    const seedSource = readSource("lib/memory/seed.ts");
    expect(seedSource).toMatch(/"purchase-snapshots\.json"/);
    expect(seedSource).toMatch(
      /purchase-snapshots\.json 必须覆盖 3 个经销商 x 3 个采购场景，共 9 条预计算记录。/,
    );

    const snapshots = JSON.parse(readSource("data/purchase-snapshots.json")) as Array<{
      customer_id: string;
      scene: string;
    }>;
    expect(snapshots).toHaveLength(9);
    expect(new Set(snapshots.map((item) => item.customer_id))).toEqual(
      new Set(["dealer_xm_sm", "dealer_dg_sm", "dealer_cd_pf"]),
    );
    expect(new Set(snapshots.map((item) => item.scene))).toEqual(
      new Set(["hot_sale_restock", "stockout_restock", "campaign_stockup"]),
    );
  });

  it("keeps Stage 5 snapshot stale UI semantics for jobs/workbench/analytics", () => {
    const generationJobsSource = readSource("app/admin/operations/generation-jobs/page.tsx");
    expect(generationJobsSource).toMatch(/isSnapshotStale/);
    expect(generationJobsSource).toMatch(/待重生成/);
    expect(generationJobsSource).toMatch(/采购建议预处理任务/);

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(
      /item\.surface === "purchase" && item\.generation_mode === "precomputed"/,
    );
    expect(workbenchSource).toMatch(
      /item\.surface === "checkout" && item\.generation_mode === "realtime"/,
    );

    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(/采购建议/);
    expect(analyticsOverviewSource).toMatch(/结算凑单/);
  });

  it("locks operator-facing admin IA and records/report source contracts", () => {
    const navigationSource = readSource("lib/navigation.ts");
    expect(navigationSource).toMatch(/label:\s*"建议生成"/);
    expect(navigationSource).toMatch(/label:\s*"结果查看"/);
    expect(navigationSource).toMatch(/label:\s*"采购建议记录"/);
    expect(navigationSource).toMatch(/label:\s*"结算凑单记录"/);

    const adminLayoutSource = readSource("app/admin/layout.tsx");
    expect(adminLayoutSource).toMatch(/href=\{group\.defaultHref\}/);
    expect(adminLayoutSource).toMatch(/href=\{item\.href\}/);
    expect(adminLayoutSource).toMatch(/\{group\.label\}/);
    expect(adminLayoutSource).toMatch(/OrchestraX运营后台/);
    expect(adminLayoutSource).not.toMatch(/当前焦点：/);
    expect(adminLayoutSource).not.toMatch(/双链路运营台/);
    expect(adminLayoutSource).not.toMatch(/当前是演示环境，所有改动只保存在内存里/);

    const recordsSource = readSource("app/admin/analytics/recommendation-records/page.tsx");
    expect(recordsSource).toMatch(/title=\{VIEW_CONFIG\[view\]\.title\}/);
    expect(recordsSource).toMatch(/normalizeRecordsView/);
    expect(recordsSource).toMatch(/searchParams\.get\("view"\)/);
    expect(recordsSource).toMatch(/searchParams\.get\("scene"\)/);
    expect(recordsSource).toMatch(/AdminDrawer/);
    expect(recordsSource).toMatch(/采购建议记录/);
    expect(recordsSource).toMatch(/结算凑单记录/);
    expect(recordsSource).toMatch(/全部经销商/);
    expect(recordsSource).not.toMatch(/经销商编码/);
    expect(recordsSource).not.toMatch(/单页双视图/);
    expect(recordsSource).not.toMatch(/当前视图仅展示/);
    expect(recordsSource).not.toMatch(/detailDescription/);
    expect(recordsSource).not.toMatch(/查看已经发给门店的采购建议/);
    expect(recordsSource).not.toMatch(/查看门店下单前触发的即时凑单推荐/);

    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(/title="结果总览"/);
    expect(analyticsOverviewSource).toMatch(/采购建议/);
    expect(analyticsOverviewSource).toMatch(/结算凑单/);
    expect(analyticsOverviewSource).toMatch(/全部经销商/);
    expect(analyticsOverviewSource).toMatch(/strategyNameMap/);
    expect(analyticsOverviewSource).not.toMatch(/异常批次清单/);
    expect(analyticsOverviewSource).not.toMatch(/待重生成/);
    expect(analyticsOverviewSource).not.toMatch(/分开查看采购建议和结算凑单的整体表现/);
    expect(analyticsOverviewSource).toMatch(
      /\/admin\/analytics\/recommendation-records\?view=checkout/,
    );

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/title="运营看板"/);
    expect(workbenchSource).not.toMatch(
      /description="先看当前采购建议是否已发布，以及采购建议和结算凑单的采纳情况。"/,
    );
    expect(workbenchSource).toMatch(/查看采购建议记录/);
    expect(workbenchSource).toMatch(/查看结算实时记录/);
    expect(workbenchSource).toMatch(/采购建议采纳情况/);
    expect(workbenchSource).toMatch(/结算凑单采纳情况/);
    expect(workbenchSource).not.toMatch(/待处理问题/);
    expect(workbenchSource).not.toMatch(/需要处理的异常批次/);
    expect(workbenchSource).not.toMatch(/失败 \/ 兜底/);
    expect(workbenchSource).not.toMatch(/已过期待重做/);
    expect(workbenchSource).toMatch(
      /\/admin\/analytics\/recommendation-records\?view=purchase/,
    );
    expect(workbenchSource).toMatch(
      /\/admin\/analytics\/recommendation-records\?view=checkout/,
    );
    expect(workbenchSource).not.toMatch(/今天最后一次动作/);

    const generationJobsSource = readSource("app/admin/operations/generation-jobs/page.tsx");
    expect(generationJobsSource).toMatch(/title="采购建议预处理任务"/);
    expect(generationJobsSource).toMatch(/sceneGroup=purchase/);
    expect(generationJobsSource).not.toMatch(/这里只管理采购建议预处理任务/);
    expect(generationJobsSource).not.toMatch(/结算页实时凑单不在此链路/);
    expect(generationJobsSource).toMatch(
      /\/admin\/analytics\/recommendation-records\?view=purchase/,
    );

    const batchesSource = readSource("app/admin/operations/recommendation-batches/page.tsx");
    expect(batchesSource).toMatch(/title="采购建议预处理批次"/);
    expect(batchesSource).not.toMatch(/这里只展示采购建议预处理批次/);
    expect(batchesSource).not.toMatch(/结算页实时凑单不会写入此页/);
    expect(batchesSource).toMatch(
      /\/admin\/analytics\/recommendation-records\?view=purchase/,
    );

    const globalRulesSource = readSource("app/admin/strategy/global-rules/page.tsx");
    expect(globalRulesSource).toMatch(/title="设置凑单规则"/);
    expect(globalRulesSource).not.toMatch(/把起订额、整箱补货和搭配补货三类规则统一配清楚/);
    expect(globalRulesSource).not.toMatch(/当门店这次下单金额还差一点点时/);
    expect(globalRulesSource).not.toMatch(/门店已经选了商品，但箱数离整箱只差一点时/);
    expect(globalRulesSource).not.toMatch(/当门店已经选了某些核心商品时/);

    const dealersSource = readSource("app/admin/master-data/dealers/page.tsx");
    expect(dealersSource).not.toMatch(/维护门店画像、常带商品和禁推偏好。/);

    const productsSource = readSource("app/admin/master-data/products/page.tsx");
    expect(productsSource).not.toMatch(/维护商品基础信息、标签和搭配关系。/);

    const segmentsSource = readSource("app/admin/master-data/segments/page.tsx");
    expect(segmentsSource).not.toMatch(/设置分组范围，方便按门店分批投放建议。/);

    const poolsSource = readSource("app/admin/master-data/product-pools/page.tsx");
    expect(poolsSource).not.toMatch(/维护推荐可引用的商品分组和搭配分组。/);

    const campaignsSource = readSource("app/admin/strategy/campaigns/page.tsx");
    expect(campaignsSource).not.toMatch(/设置活动商品和适用门店范围。/);

    const strategiesSource = readSource("app/admin/strategy/recommendation-strategies/page.tsx");
    expect(strategiesSource).not.toMatch(/设置适用门店、候选商品和推荐话术，并可预览发给 AI 的重点。/);

    const expressionTemplatesSource = readSource("app/admin/strategy/expression-templates/page.tsx");
    expect(expressionTemplatesSource).not.toMatch(/维护推荐说明生成时要用到的话术字段。/);

    expect(generationJobsSource).not.toMatch(/先设置采购链路覆盖范围与方案，预检\/试生成\/发布在列表中执行。/);
  });
});
