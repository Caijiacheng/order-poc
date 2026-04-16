export const FRONTSTAGE_ROUTES = [
  "/procurement",
  "/catalog",
  "/basket",
  "/checkout",
] as const;

export const ADMIN_ROUTES = [
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
] as const;

export const ENTRY_REDIRECT_ROUTES = ["/", "/admin"] as const;

export const REQUIRED_ROUTES = [
  ...ENTRY_REDIRECT_ROUTES,
  ...FRONTSTAGE_ROUTES,
  ...ADMIN_ROUTES,
] as const;
