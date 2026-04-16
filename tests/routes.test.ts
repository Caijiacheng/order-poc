import { describe, expect, it } from "vitest";

import {
  ADMIN_ROUTES,
  ENTRY_REDIRECT_ROUTES,
  FRONTSTAGE_ROUTES,
  REQUIRED_ROUTES,
} from "../lib/routes";

describe("required route coverage", () => {
  it("includes all frontstage routes", () => {
    expect(FRONTSTAGE_ROUTES).toEqual([
      "/procurement",
      "/catalog",
      "/basket",
      "/checkout",
    ]);
    expect(FRONTSTAGE_ROUTES).toHaveLength(4);
  });

  it("includes all admin routes", () => {
    expect(ADMIN_ROUTES).toEqual([
      "/admin/workbench/overview",
      "/admin/master-data/products",
      "/admin/master-data/dealers",
      "/admin/strategy/recommendation-templates",
      "/admin/strategy/campaigns",
      "/admin/strategy/rules",
      "/admin/strategy/ai-expression",
      "/admin/analytics/overview",
      "/admin/analytics/recommendations",
      "/admin/observability/audit-logs",
      "/admin/observability/traces",
    ]);
    expect(ADMIN_ROUTES).toHaveLength(11);
  });

  it("keeps redirect entry routes separate from canonical page routes", () => {
    expect(ENTRY_REDIRECT_ROUTES).toEqual(["/", "/admin"]);
    expect(ADMIN_ROUTES).not.toContain("/");
    expect(ADMIN_ROUTES).not.toContain("/admin");
    expect(FRONTSTAGE_ROUTES).not.toContain("/");
    expect(FRONTSTAGE_ROUTES).not.toContain("/admin");
  });

  it("combines entry routes and canonical routes into required list without duplicates", () => {
    expect(REQUIRED_ROUTES).toEqual([
      ...ENTRY_REDIRECT_ROUTES,
      ...FRONTSTAGE_ROUTES,
      ...ADMIN_ROUTES,
    ]);
    expect(REQUIRED_ROUTES).toHaveLength(17);
    expect(new Set(REQUIRED_ROUTES).size).toBe(REQUIRED_ROUTES.length);
  });
});
