export const FRONTSTAGE_NAV = [
  { href: "/procurement", label: "采购首页", hint: "待补货与常购入口" },
  { href: "/catalog", label: "商品选购", hint: "采购工作台" },
  { href: "/basket", label: "采购清单", hint: "订单校正与优化" },
  { href: "/checkout", label: "下单确认", hint: "交易确认" },
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
};

export const ADMIN_NAV_TREE: readonly AdminNavGroup[] = [
  {
    key: "workbench",
    label: "工作台",
    defaultHref: "/admin/workbench/overview",
    items: [{ href: "/admin/workbench/overview", label: "运营总览" }],
  },
  {
    key: "master-data",
    label: "主数据管理",
    defaultHref: "/admin/master-data/products",
    items: [
      { href: "/admin/master-data/products", label: "商品档案" },
      { href: "/admin/master-data/dealers", label: "经销商档案" },
    ],
  },
  {
    key: "strategy",
    label: "推荐与策略",
    defaultHref: "/admin/strategy/recommendation-templates",
    items: [
      {
        href: "/admin/strategy/recommendation-templates",
        label: "推荐模板",
      },
      { href: "/admin/strategy/campaigns", label: "活动策略" },
      { href: "/admin/strategy/rules", label: "推荐规则" },
      { href: "/admin/strategy/ai-expression", label: "AI 表达配置" },
    ],
  },
  {
    key: "analytics",
    label: "数据与分析",
    defaultHref: "/admin/analytics/overview",
    items: [
      { href: "/admin/analytics/overview", label: "经营总览" },
      { href: "/admin/analytics/recommendations", label: "推荐记录" },
    ],
  },
  {
    key: "observability",
    label: "审计与演示观察",
    defaultHref: "/admin/observability/audit-logs",
    items: [
      { href: "/admin/observability/audit-logs", label: "审计日志" },
      { href: "/admin/observability/traces", label: "链路观察" },
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
