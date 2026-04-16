import { readFileSync } from "node:fs";
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

  it("keeps admin page ids", () => {
    const adminLayoutSource = readSource("app/admin/layout.tsx");
    expectTestIdContract(adminLayoutSource, "admin-primary-nav");
    expectTestIdContract(adminLayoutSource, "admin-secondary-nav");

    const workbenchSource = readSource("app/admin/workbench/overview/page.tsx");
    expectTestIdContract(workbenchSource, "admin-workbench-kpis");

    const recommendationSource = readSource(
      "app/admin/analytics/recommendations/page.tsx",
    );
    expectTestIdContract(recommendationSource, "recommendation-report-table");
    expectTestIdContract(recommendationSource, "trace-link");

    const traceSource = readSource("app/admin/observability/traces/page.tsx");
    expectTestIdContract(traceSource, "trace-link");
  });
});
