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
    expect(purchaseSource).toMatch(/右侧采购摘要/);
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

});

describe("admin canonical source contract", () => {
  it("keeps admin page ids", () => {
    const adminLayoutSource = readSource("app/admin/layout.tsx");
    expectTestIdContract(adminLayoutSource, "admin-primary-nav");
    expectTestIdContract(adminLayoutSource, "admin-secondary-nav");

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/title="今日看板"/);

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
    expect(workbenchSource).toMatch(/\/api\/admin\/audit-logs/);
    expect(workbenchSource).not.toMatch(/\/api\/admin\/reports\//);

    const auditLogsSource = readSource("app/admin/observability/audit-logs/page.tsx");
    expect(auditLogsSource).toMatch(/\/api\/admin\/audit-logs/);
    expect(auditLogsSource).not.toMatch(/\/api\/admin\/reports\//);

    const analyticsOverviewSource = readSource("app/admin/analytics/overview/page.tsx");
    expect(analyticsOverviewSource).toMatch(/\/api\/admin\/recommendation-batches/);
    expect(analyticsOverviewSource).toMatch(/\/api\/admin\/recommendation-records/);
    expect(analyticsOverviewSource).not.toMatch(/\/api\/admin\/reports\//);
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

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/\/api\/admin\/audit-logs/);

    const auditLogsSource = readSource("app/admin/observability/audit-logs/page.tsx");
    expect(auditLogsSource).toMatch(/\/api\/admin\/audit-logs/);
  });
});
