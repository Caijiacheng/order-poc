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
  "/admin/master-data/segments",
  "/admin/master-data/product-pools",
  "/admin/strategy/campaigns",
  "/admin/strategy/recommendation-strategies",
  "/admin/strategy/expression-templates",
  "/admin/strategy/global-rules",
  "/admin/operations/generation-jobs",
  "/admin/operations/recommendation-batches",
  "/admin/analytics/overview",
  "/admin/analytics/recommendation-records",
  "/admin/observability/audit-logs",
  "/admin/observability/traces",
  "/admin/observability/recovery",
] as const;

export const ENTRY_REDIRECT_ROUTES = ["/", "/admin"] as const;

export const REQUIRED_ROUTES = [
  ...ENTRY_REDIRECT_ROUTES,
  ...FRONTSTAGE_ROUTES,
  ...ADMIN_ROUTES,
] as const;
