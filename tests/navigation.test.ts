import { describe, expect, it } from "vitest";

import { ADMIN_NAV_TREE, getAdminRouteMatch } from "../lib/navigation";
import { ADMIN_ROUTES } from "../lib/routes";

describe("admin navigation IA contract", () => {
  it("keeps 5 primary groups with canonical default child mapping", () => {
    expect(
      ADMIN_NAV_TREE.map((group) => ({
        key: group.key,
        defaultHref: group.defaultHref,
      })),
    ).toEqual([
      { key: "workbench", defaultHref: "/admin/workbench/overview" },
      { key: "master-data", defaultHref: "/admin/master-data/products" },
      {
        key: "strategy",
        defaultHref: "/admin/strategy/recommendation-templates",
      },
      { key: "analytics", defaultHref: "/admin/analytics/overview" },
      { key: "observability", defaultHref: "/admin/observability/audit-logs" },
    ]);
    expect(ADMIN_NAV_TREE).toHaveLength(5);
  });

  it("keeps canonical admin leaf routes aligned with route registry", () => {
    const navLeafRoutes = ADMIN_NAV_TREE.flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(navLeafRoutes).toEqual(ADMIN_ROUTES);
    expect(navLeafRoutes).toHaveLength(11);
  });

  it("maps each group default href to the first child and active route match", () => {
    for (const group of ADMIN_NAV_TREE) {
      expect(group.items[0]?.href).toBe(group.defaultHref);
      const match = getAdminRouteMatch(group.defaultHref);
      expect(match?.group.key).toBe(group.key);
      expect(match?.item?.href).toBe(group.defaultHref);
    }
  });
});
