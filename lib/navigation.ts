export const FRONTSTAGE_NAV = [
  { href: "/purchase", label: "开始选货", hint: "本周建议和选货" },
  { href: "/order-submit", label: "确认下单", hint: "确认商品和提交订单" },
] as const;

export type AdminNavItem = {
  href: string;
  label: string;
};

export type AdminNavGroup = {
  key: string;
  label: string;
  defaultHref: string;
  items: readonly AdminNavItem[];
  hidden?: boolean;
};

export const ADMIN_NAV_TREE: readonly AdminNavGroup[] = [
  {
    key: "workbench",
    label: "先看整体",
    defaultHref: "/admin/workbench/overview",
    items: [{ href: "/admin/workbench/overview", label: "今日看板" }],
  },
  {
    key: "master-data",
    label: "维护基础信息",
    defaultHref: "/admin/master-data/products",
    items: [
      { href: "/admin/master-data/products", label: "维护商品" },
      { href: "/admin/master-data/dealers", label: "维护门店" },
      { href: "/admin/master-data/segments", label: "维护门店分组" },
      { href: "/admin/master-data/product-pools", label: "维护商品分组" },
    ],
  },
  {
    key: "strategy",
    label: "设置投放规则",
    defaultHref: "/admin/strategy/campaigns",
    items: [
      { href: "/admin/strategy/campaigns", label: "安排活动" },
      { href: "/admin/strategy/recommendation-strategies", label: "设置推荐方案" },
      { href: "/admin/strategy/expression-templates", label: "设置推荐话术" },
      { href: "/admin/strategy/global-rules", label: "设置凑单规则" },
    ],
  },
  {
    key: "operations",
    label: "生成与发布",
    defaultHref: "/admin/operations/generation-jobs",
    items: [
      { href: "/admin/operations/generation-jobs", label: "生成建议单" },
      {
        href: "/admin/operations/recommendation-batches",
        label: "查看生成批次",
      },
    ],
  },
  {
    key: "analytics",
    label: "查看结果",
    defaultHref: "/admin/analytics/overview",
    items: [
      { href: "/admin/analytics/overview", label: "结果总览" },
      {
        href: "/admin/analytics/recommendation-records",
        label: "查看门店建议",
      },
    ],
  },
  {
    key: "observability",
    label: "排查与重置",
    defaultHref: "/admin/observability/audit-logs",
    hidden: true,
    items: [
      { href: "/admin/observability/audit-logs", label: "查看变更记录" },
      { href: "/admin/observability/traces", label: "查看执行过程" },
      { href: "/admin/observability/recovery", label: "恢复演示数据" },
    ],
  },
] as const;

const normalizePathname = (pathname: string) => {
  if (pathname !== "/" && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

type AdminRouteMatch = {
  group: AdminNavGroup;
  item?: AdminNavItem;
};

export function getAdminRouteMatch(pathname: string): AdminRouteMatch | null {
  const normalized = normalizePathname(pathname);

  for (const group of ADMIN_NAV_TREE) {
    for (const item of group.items) {
      if (item.href === normalized || normalized.startsWith(`${item.href}/`)) {
        return { group, item };
      }
    }
  }

  for (const group of ADMIN_NAV_TREE) {
    if (
      group.defaultHref === normalized ||
      normalized.startsWith(`${group.defaultHref}/`)
    ) {
      return { group };
    }
  }

  return null;
}

export function getAdminBreadcrumb(pathname: string): string[] {
  const match = getAdminRouteMatch(pathname);
  if (!match) {
    return [];
  }
  if (match.item) {
    return [match.group.label, match.item.label];
  }
  return [match.group.label];
}
