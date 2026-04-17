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

describe("source testid contract", () => {
  it("keeps frontstage page ids", () => {
    const procurementSource = readSource("app/(frontstage)/procurement/page.tsx");
    expectTestIdContract(procurementSource, "procurement-home");
    expectTestIdContract(procurementSource, "replenishment-module");
    expectTestIdContract(procurementSource, "quick-reorder-module");
    expectTestIdContract(procurementSource, "campaign-module");

    const catalogSource = readSource("app/(frontstage)/catalog/page.tsx");
    expectTestIdContract(catalogSource, "catalog-grid");

    const basketSource = readSource("app/(frontstage)/basket/page.tsx");
    expectTestIdContract(basketSource, "basket-summary");
    expectTestIdContract(basketSource, "basket-optimization-panel");

    const checkoutSource = readSource("app/(frontstage)/checkout/page.tsx");
    expectTestIdContract(checkoutSource, "checkout-summary");
  });

  it("keeps procurement/catalog on published-suggestions readonly contract", () => {
    const procurementSource = readSource("app/(frontstage)/procurement/page.tsx");
    expectPublishedSuggestionReadonlyContract(procurementSource);
    expect(procurementSource).toMatch(/\bfetchPublishedSuggestions\s*\(/);

    const catalogSource = readSource("app/(frontstage)/catalog/page.tsx");
    expectPublishedSuggestionReadonlyContract(catalogSource);
    expect(catalogSource).toMatch(/\bfetchPublishedSuggestions\s*\(/);

    const frontstageApiSource = readSource("lib/frontstage/api.ts");
    expect(frontstageApiSource).toMatch(
      /\/api\/frontstage\/published-suggestions\?customerId=/,
    );
  });

  it("keeps admin page ids", () => {
    const adminLayoutSource = readSource("app/admin/layout.tsx");
    expectTestIdContract(adminLayoutSource, "admin-primary-nav");
    expectTestIdContract(adminLayoutSource, "admin-secondary-nav");

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expect(workbenchSource).toMatch(/title="运营工作台"/);

    const recommendationSource = readSource(
      "app/admin/analytics/recommendation-records/page.tsx",
    );
    expectTestIdContract(recommendationSource, "recommendation-report-table");
    expectTestIdContract(recommendationSource, "trace-link");

    const traceSource = readSource("app/admin/observability/traces/page.tsx");
    expectTestIdContract(traceSource, "trace-link");
  });

  it("does not expose legacy admin route page contracts", () => {
    expect(existsSync(path.join(process.cwd(), "app/admin/analytics/recommendations/page.tsx"))).toBe(
      false,
    );
    expect(
      existsSync(path.join(process.cwd(), "app/admin/strategy/recommendation-templates/page.tsx")),
    ).toBe(false);
    expect(existsSync(path.join(process.cwd(), "app/admin/strategy/rules/page.tsx"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "app/admin/strategy/ai-expression/page.tsx"))).toBe(
      false,
    );
  });
});

describe("admin canonical migration source contract", () => {
  it("locks strategy/reports pages to canonical APIs and rejects legacy sources", () => {
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

  it("keeps workbench/audit/analytics pages off legacy reports endpoints", () => {
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
