export const FRONTSTAGE_NAV = [
  { href: "/purchase", label: "开始选货", hint: "本周建议和选货" },
  { href: "/order-submit", label: "确认下单", hint: "确认商品和提交订单" },
] as const;

export type AdminNavItem = {
  href: string;
  label: string;
  matchPath?: string;
  matchQuery?: Record<string, string>;
  breadcrumbLabel?: string;
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
    label: "运营看板",
    defaultHref: "/admin/workbench/overview",
    items: [{ href: "/admin/workbench/overview", label: "运营总览" }],
  },
  {
    key: "master-data",
    label: "基础资料",
    defaultHref: "/admin/master-data/products",
    items: [
      { href: "/admin/master-data/products", label: "商品资料" },
      { href: "/admin/master-data/dealers", label: "经销商资料" },
      { href: "/admin/master-data/segments", label: "经销商分组" },
      { href: "/admin/master-data/product-pools", label: "商品池配置" },
    ],
  },
  {
    key: "strategy",
    label: "策略与规则",
    defaultHref: "/admin/strategy/campaigns",
    items: [
      { href: "/admin/strategy/campaigns", label: "促销活动" },
      { href: "/admin/strategy/recommendation-strategies", label: "推荐方案" },
      { href: "/admin/strategy/expression-templates", label: "话术模板" },
      { href: "/admin/strategy/global-rules", label: "凑单规则" },
    ],
  },
  {
    key: "operations",
    label: "建议生成",
    defaultHref: "/admin/operations/generation-jobs",
    items: [
      { href: "/admin/operations/generation-jobs", label: "生成任务" },
      {
        href: "/admin/operations/recommendation-batches",
        label: "生成批次",
      },
    ],
  },
  {
    key: "analytics",
    label: "结果查看",
    defaultHref: "/admin/analytics/overview",
    items: [
      { href: "/admin/analytics/overview", label: "结果总览" },
      {
        href: "/admin/analytics/recommendation-records?view=purchase",
        label: "采购建议记录",
        matchPath: "/admin/analytics/recommendation-records",
        matchQuery: { view: "purchase" },
      },
      {
        href: "/admin/analytics/recommendation-records?view=checkout",
        label: "结算凑单记录",
        matchPath: "/admin/analytics/recommendation-records",
        matchQuery: { view: "checkout" },
      },
    ],
  },
  {
    key: "observability",
    label: "排查与恢复",
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

const normalizeHrefPath = (href: string) => normalizePathname(href.split("?")[0] ?? href);

function matchesQuery(
  requiredQuery: Record<string, string> | undefined,
  currentQuery: URLSearchParams,
) {
  if (!requiredQuery) {
    return true;
  }
  return Object.entries(requiredQuery).every(([key, value]) => {
    const currentValue = currentQuery.get(key);
    if (currentValue === value) {
      return true;
    }
    if (key === "view" && value === "purchase" && !currentValue) {
      return true;
    }
    return false;
  });
}

type AdminRouteMatch = {
  group: AdminNavGroup;
  item?: AdminNavItem;
};

export function getAdminRouteMatch(
  pathname: string,
  searchParams?: URLSearchParams | string,
): AdminRouteMatch | null {
  const normalized = normalizePathname(pathname);
  const currentQuery =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams ?? "");

  for (const group of ADMIN_NAV_TREE) {
    for (const item of group.items) {
      const matchPath = normalizeHrefPath(item.matchPath ?? item.href);
      if (
        (matchPath === normalized || normalized.startsWith(`${matchPath}/`)) &&
        matchesQuery(item.matchQuery, currentQuery)
      ) {
        return { group, item };
      }
    }
  }

  for (const group of ADMIN_NAV_TREE) {
    const defaultPath = normalizeHrefPath(group.defaultHref);
    if (
      defaultPath === normalized ||
      normalized.startsWith(`${defaultPath}/`)
    ) {
      return { group };
    }
  }

  return null;
}

export function getAdminBreadcrumb(
  pathname: string,
  searchParams?: URLSearchParams | string,
): string[] {
  const match = getAdminRouteMatch(pathname, searchParams);
  if (!match) {
    return [];
  }
  if (match.item) {
    return [match.group.label, match.item.breadcrumbLabel ?? match.item.label];
  }
  return [match.group.label];
}
