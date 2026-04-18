import { describe, expect, it } from "vitest";

import {
  ADMIN_NAV_TREE,
  FRONTSTAGE_NAV,
  getAdminRouteMatch,
} from "../lib/navigation";
import { ADMIN_ROUTES, FRONTSTAGE_ROUTES } from "../lib/routes";

describe("admin navigation IA contract", () => {
  it("keeps frontstage nav on canonical purchase/order-submit flow", () => {
    const frontstageNavRoutes = FRONTSTAGE_NAV.map((item) => item.href);
    expect(frontstageNavRoutes).toEqual(FRONTSTAGE_ROUTES);
    expect(frontstageNavRoutes).toEqual(["/purchase", "/order-submit"]);
  });

  it("keeps 6 primary groups with canonical default child mapping", () => {
    expect(
      ADMIN_NAV_TREE.map((group) => ({
        key: group.key,
        defaultHref: group.defaultHref,
      })),
    ).toEqual([
      { key: "workbench", defaultHref: "/admin/workbench/overview" },
      { key: "master-data", defaultHref: "/admin/master-data/products" },
      { key: "strategy", defaultHref: "/admin/strategy/campaigns" },
      { key: "operations", defaultHref: "/admin/operations/generation-jobs" },
      { key: "analytics", defaultHref: "/admin/analytics/overview" },
      { key: "observability", defaultHref: "/admin/observability/audit-logs" },
    ]);
    expect(ADMIN_NAV_TREE).toHaveLength(6);
  });

  it("locks Stage 6 dual-chain IA labels on canonical routes", () => {
    const groupByKey = new Map(ADMIN_NAV_TREE.map((group) => [group.key, group]));
    expect(groupByKey.get("operations")?.label).toBe("建议生成");
    expect(groupByKey.get("analytics")?.label).toBe("结果查看");
    expect(
      groupByKey
        .get("analytics")
        ?.items.find(
          (item) => item.href === "/admin/analytics/recommendation-records?view=purchase",
        )
        ?.label,
    ).toBe("采购建议记录");
    expect(
      groupByKey
        .get("analytics")
        ?.items.find(
          (item) => item.href === "/admin/analytics/recommendation-records?view=checkout",
        )
        ?.label,
    ).toBe("结算凑单记录");
  });

  it("keeps canonical admin leaf routes aligned with route registry", () => {
    const navLeafRoutes = Array.from(
      new Set(
        ADMIN_NAV_TREE.flatMap((group) =>
          group.items.map((item) => item.matchPath ?? item.href.split("?")[0] ?? item.href),
        ),
      ),
    );
    expect(navLeafRoutes).toEqual(ADMIN_ROUTES);
    expect(navLeafRoutes).toHaveLength(16);
  });

  it("maps each group default href to the first child and active route match", () => {
    for (const group of ADMIN_NAV_TREE) {
      expect(group.items[0]?.href).toBe(group.defaultHref);
      const match = getAdminRouteMatch(group.defaultHref);
      expect(match?.group.key).toBe(group.key);
      expect(match?.item?.href).toBe(group.defaultHref);
    }
  });

  it("supports query-based secondary nav items for recommendation records", () => {
    const purchaseMatch = getAdminRouteMatch(
      "/admin/analytics/recommendation-records",
      new URLSearchParams("view=purchase"),
    );
    expect(purchaseMatch?.item?.href).toBe(
      "/admin/analytics/recommendation-records?view=purchase",
    );

    const checkoutMatch = getAdminRouteMatch(
      "/admin/analytics/recommendation-records",
      new URLSearchParams("view=checkout"),
    );
    expect(checkoutMatch?.item?.href).toBe(
      "/admin/analytics/recommendation-records?view=checkout",
    );
  });
});
