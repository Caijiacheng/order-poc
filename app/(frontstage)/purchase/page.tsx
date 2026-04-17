"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Loader2, ShoppingCart, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCartItem,
  fetchActiveDealers,
  fetchActiveProducts,
  fetchCart,
  fetchPublishedSuggestions,
  formatMoney,
} from "@/lib/frontstage/api";
import type {
  ActivityHighlight,
  BundleTemplate,
  BundleTemplateItem,
  CartSession,
  DealerEntity,
  ProductEntity,
  PublishedSuggestionsCartSummary,
} from "@/lib/memory/types";

type PublishedSuggestionsState = Awaited<ReturnType<typeof fetchPublishedSuggestions>>;
type ProcurementView = "all" | "frequent" | "replenishment" | "campaign" | "new";
type ReasonDrawerState =
  | { type: "bundle"; template: BundleTemplate }
  | { type: "activity"; activity: ActivityHighlight }
  | null;

const VIEW_OPTIONS: Array<{ key: ProcurementView; label: string }> = [
  { key: "all", label: "全部商品" },
  { key: "frequent", label: "常购" },
  { key: "replenishment", label: "待补货" },
  { key: "campaign", label: "活动" },
  { key: "new", label: "新品" },
];

const EMPTY_SUMMARY: PublishedSuggestionsCartSummary = {
  source: "template_projection",
  sku_count: 0,
  item_count: 0,
  total_amount: 0,
  threshold_amount: 0,
  gap_to_threshold: 0,
  threshold_reached: false,
};

function mergeItems(items: BundleTemplateItem[]) {
  const map = new Map<string, BundleTemplateItem>();
  for (const item of items) {
    const existing = map.get(item.sku_id);
    if (!existing || item.suggested_qty > existing.suggested_qty) {
      map.set(item.sku_id, item);
    }
  }
  return Array.from(map.values());
}

function toBundleValueSummary(template: BundleTemplate) {
  if (template.template_type === "hot_sale_restock") {
    return "聚焦高动销品，优先保障本轮周转与缺货风险。";
  }
  if (template.template_type === "stockout_restock") {
    return "面向常购基础货做缺货补位，降低断货概率。";
  }
  return "按当前活动节奏提前备货，承接本周推广目标。";
}

function toBundleRationale(template: BundleTemplate) {
  const tags = new Set<string>();
  for (const item of template.items) {
    for (const tag of item.reason_tags) {
      tags.add(tag);
    }
  }
  const selected = Array.from(tags).slice(0, 3);
  if (selected.length === 0) {
    return "基于当前经销商画像、活动范围与发布结果，系统给出可执行组货组合。";
  }
  return `模型结合 ${selected.join("、")} 等信号做优先级排序，输出当前模板内 SKU 组合。`;
}

function toActivityValueSummary(activity: ActivityHighlight) {
  return `围绕活动门槛 ${formatMoney(activity.promo_threshold)} 组织备货，覆盖 ${activity.items.length} 个活动 SKU。`;
}

export default function PurchasePage() {
  const router = useRouter();
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [suggestions, setSuggestions] = useState<PublishedSuggestionsState | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<ProcurementView>("all");
  const [qtyDraftBySku, setQtyDraftBySku] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [reasonDrawer, setReasonDrawer] = useState<ReasonDrawerState>(null);

  useEffect(() => {
    const bootstrap = async () => {
      setLoadingPage(true);
      try {
        const [dealerList, productList, cartSession] = await Promise.all([
          fetchActiveDealers(),
          fetchActiveProducts(),
          fetchCart(),
        ]);
        setDealers(dealerList);
        setProducts(productList);
        setCart(cartSession);
        setDealerId(
          (prev) => prev || cartSession.customer_id || dealerList[0]?.customer_id || "",
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载采购工作台失败");
      } finally {
        setLoadingPage(false);
      }
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    const loadSuggestions = async () => {
      if (!dealerId) {
        return;
      }
      setLoadingSuggestions(true);
      setErrorMessage("");
      try {
        const result = await fetchPublishedSuggestions(dealerId);
        setSuggestions(result);
        setSuccessMessage(
          result.summary.published
            ? "已加载模板化建议，可从模板与活动专区快速下单。"
            : "当前无已发布建议，已回退到模板默认候选与活动专区。",
        );
      } catch (error) {
        setSuggestions(null);
        setErrorMessage(error instanceof Error ? error.message : "加载采购模板失败");
      } finally {
        setLoadingSuggestions(false);
      }
    };

    void loadSuggestions();
  }, [dealerId]);

  const currentDealer = useMemo(
    () => dealers.find((item) => item.customer_id === dealerId) ?? null,
    [dealerId, dealers],
  );

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.sku_id, product])),
    [products],
  );

  const categories = useMemo(
    () => Array.from(new Set(products.map((item) => item.category))),
    [products],
  );

  const frequentSkuSet = useMemo(
    () => new Set(currentDealer?.frequent_items ?? []),
    [currentDealer],
  );

  const bundleTemplates = suggestions?.bundleTemplates ?? [];
  const activityHighlights = suggestions?.activityHighlights ?? [];

  const replenishmentSkuSet = useMemo(() => {
    const stockout = bundleTemplates.find(
      (template) => template.template_type === "stockout_restock",
    );
    return new Set((stockout?.items ?? []).map((item) => item.sku_id));
  }, [bundleTemplates]);

  const campaignSkuSet = useMemo(() => {
    const set = new Set<string>();
    for (const activity of activityHighlights) {
      for (const skuId of activity.sku_ids) {
        set.add(skuId);
      }
    }
    return set;
  }, [activityHighlights]);

  const recommendedSkuSet = useMemo(() => {
    const set = new Set<string>();
    for (const template of bundleTemplates) {
      for (const item of template.items) {
        set.add(item.sku_id);
      }
    }
    return set;
  }, [bundleTemplates]);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const q = searchText.trim().toLowerCase();
        const matchQ =
          q.length === 0 ||
          product.sku_name.toLowerCase().includes(q) ||
          product.sku_id.toLowerCase().includes(q) ||
          product.tags.join(" ").toLowerCase().includes(q);
        const matchCategory =
          categoryFilter === "all" || product.category === categoryFilter;

        let matchView = true;
        if (viewFilter === "frequent") {
          matchView = frequentSkuSet.has(product.sku_id);
        } else if (viewFilter === "replenishment") {
          matchView = replenishmentSkuSet.has(product.sku_id);
        } else if (viewFilter === "campaign") {
          matchView = campaignSkuSet.has(product.sku_id) || product.is_weekly_focus;
        } else if (viewFilter === "new") {
          matchView = product.is_new_product;
        }

        return matchQ && matchCategory && matchView;
      }),
    [
      campaignSkuSet,
      categoryFilter,
      frequentSkuSet,
      products,
      replenishmentSkuSet,
      searchText,
      viewFilter,
    ],
  );

  const displaySummary = cart?.summary ?? suggestions?.cartSummary ?? EMPTY_SUMMARY;

  const reloadCart = async () => {
    const latest = await fetchCart();
    setCart(latest);
  };

  const handleAddProduct = async (product: ProductEntity, qty: number) => {
    const actionKey = `sku:${product.sku_id}`;
    setBusyKey(actionKey);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        sku_id: product.sku_id,
        qty: Math.max(1, qty),
        source: "manual",
      });
      await reloadCart();
      setSuccessMessage(`已加入采购清单：${product.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入采购清单失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleQuickOrder = async (input: {
    key: string;
    items: BundleTemplateItem[];
    successLabel: string;
    navigate: boolean;
  }) => {
    const merged = mergeItems(input.items);
    if (!dealerId || merged.length === 0) {
      if (input.navigate) {
        router.push("/order-submit");
      }
      return;
    }
    setBusyKey(input.key);
    setErrorMessage("");
    setSuccessMessage("");
    let count = 0;
    try {
      for (const item of merged) {
        await addCartItem({
          customerId: dealerId,
          sku_id: item.sku_id,
          qty: Math.max(1, item.suggested_qty),
          source: "manual",
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已加入 ${count} 个 SKU：${input.successLabel}`);
      if (input.navigate) {
        router.push("/order-submit");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "快速下单失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleSummaryBundleCheckout = async () => {
    await handleQuickOrder({
      key: "summary:bundle-checkout",
      items: bundleTemplates.flatMap((template) => template.items),
      successLabel: "组货后去结算",
      navigate: true,
    });
  };

  return (
    <div className="space-y-5" data-testid="purchase-workbench">
      <Card className="border-slate-200 bg-white/95">
        <CardHeader className="space-y-3">
          <Badge className="w-fit rounded-full px-3 py-1">采购工作台</Badge>
          <CardTitle className="text-3xl leading-tight text-slate-950">
            组货模板 + 活动专区 + 商品选购一体采购
          </CardTitle>
          <p className="text-sm leading-6 text-slate-600">
            点击模板或活动的“快速下单”会将对应商品加入采购清单并进入结算页，不会静默提交订单。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Demo Mode · 经销商切换
            </p>
            <div className="mt-2">
              <Select value={dealerId} onValueChange={setDealerId} disabled={loadingPage}>
                <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                  <SelectValue placeholder="选择经销商" />
                </SelectTrigger>
                <SelectContent>
                  {dealers.map((dealer) => (
                    <SelectItem key={dealer.customer_id} value={dealer.customer_id}>
                      {dealer.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {currentDealer ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-900">{currentDealer.customer_name}</p>
              <p className="mt-1 text-slate-600">
                {currentDealer.city} · {currentDealer.customer_type} · 下单频次{" "}
                {currentDealer.order_frequency}
              </p>
            </div>
          ) : null}

          {loadingSuggestions ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              正在同步模板化建议...
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}
          {successMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {successMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <section className="grid gap-4 lg:grid-cols-3" data-testid="purchase-bundle-templates">
            {bundleTemplates.map((template) => (
              <BundleTemplateCard
                key={template.template_id}
                template={template}
                busyKey={busyKey}
                onAdd={() =>
                  void handleQuickOrder({
                    key: `bundle:add:${template.template_id}`,
                    items: template.items,
                    successLabel: template.template_name,
                    navigate: false,
                  })
                }
                onQuickOrder={() =>
                  void handleQuickOrder({
                    key: `bundle:quick:${template.template_id}`,
                    items: template.items,
                    successLabel: `${template.template_name}（快速下单）`,
                    navigate: true,
                  })
                }
                onViewReason={() => setReasonDrawer({ type: "bundle", template })}
              />
            ))}
          </section>

          <section data-testid="purchase-activity-zone">
            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-xl text-slate-900">活动专区</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {activityHighlights.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    当前经销商暂无可用活动，仍可使用三种组货模板与商品选购继续下单。
                  </div>
                ) : (
                  activityHighlights.map((activity) => (
                    <ActivityCard
                      key={activity.activity_id}
                      activity={activity}
                      busy={busyKey === `activity:quick:${activity.activity_id}`}
                      onQuickOrder={() =>
                        void handleQuickOrder({
                          key: `activity:quick:${activity.activity_id}`,
                          items: activity.items,
                          successLabel: `${activity.activity_name}（活动快速下单）`,
                          navigate: true,
                        })
                      }
                      onViewReason={() => setReasonDrawer({ type: "activity", activity })}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          <section data-testid="purchase-catalog-zone">
            <Card className="border-slate-200 bg-white/92">
              <CardHeader className="space-y-3">
                <CardTitle className="text-xl text-slate-900">商品选购区</CardTitle>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    placeholder="搜索 SKU / 名称 / 标签"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                      <SelectValue placeholder="分类筛选" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部分类</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={viewFilter}
                    onValueChange={(next) => setViewFilter(next as ProcurementView)}
                  >
                    <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                      <SelectValue placeholder="选购视图" />
                    </SelectTrigger>
                    <SelectContent>
                      {VIEW_OPTIONS.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingPage ? (
                  <div className="py-10 text-center text-sm text-slate-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    商品加载中...
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    当前筛选条件下暂无商品。
                  </div>
                ) : (
                  filteredProducts.slice(0, 20).map((product) => (
                    <div
                      key={product.sku_id}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{product.sku_name}</p>
                          <p className="font-mono text-xs text-slate-500">{product.sku_id}</p>
                        </div>
                        <Badge variant="outline">{formatMoney(product.price_per_case)}/箱</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="secondary">{product.category}</Badge>
                        <Badge variant="outline">箱规 {product.box_multiple}</Badge>
                        {recommendedSkuSet.has(product.sku_id) ? (
                          <Badge variant="outline">模板建议</Badge>
                        ) : null}
                        {product.is_weekly_focus ? <Badge variant="outline">活动</Badge> : null}
                        {product.is_new_product ? <Badge variant="outline">新品</Badge> : null}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-[100px_1fr]">
                        <Input
                          type="number"
                          min={1}
                          value={
                            qtyDraftBySku[product.sku_id] ??
                            String(Math.max(1, product.box_multiple))
                          }
                          onChange={(event) =>
                            setQtyDraftBySku((prev) => ({
                              ...prev,
                              [product.sku_id]: event.target.value,
                            }))
                          }
                          aria-label={`${product.sku_name} 采购数量`}
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            void handleAddProduct(
                              product,
                              Number.parseInt(
                                qtyDraftBySku[product.sku_id] ??
                                  String(Math.max(1, product.box_multiple)),
                                10,
                              ) || Math.max(1, product.box_multiple),
                            )
                          }
                          disabled={busyKey === `sku:${product.sku_id}`}
                        >
                          {busyKey === `sku:${product.sku_id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShoppingCart className="h-4 w-4" />
                          )}
                          加入采购清单
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        <aside data-testid="purchase-procurement-summary">
          <Card className="h-fit border-slate-200 bg-gradient-to-b from-slate-50 to-white xl:sticky xl:top-24">
            <CardHeader>
              <CardTitle className="text-xl text-slate-900">右侧采购摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">SKU / 件数</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {displaySummary.sku_count} / {displaySummary.item_count}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">采购金额 / 门槛</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {formatMoney(displaySummary.total_amount)} /{" "}
                  {formatMoney(displaySummary.threshold_amount)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {displaySummary.threshold_reached
                    ? "已达到门槛，可进入结算页提交订单。"
                    : `距门槛还差 ${formatMoney(displaySummary.gap_to_threshold)}`}
                </p>
              </div>
              <div className="grid gap-2">
                <Button className="w-full" onClick={() => router.push("/order-submit")}>
                  去结算
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleSummaryBundleCheckout()}
                  disabled={busyKey === "summary:bundle-checkout" || bundleTemplates.length === 0}
                >
                  {busyKey === "summary:bundle-checkout" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                  组货后去结算
                </Button>
                <p className="text-xs text-slate-500">
                  两个入口都不会直接提交订单；组货路径会先按模板加车再进入结算页。
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </section>

      <ReasonDrawer
        open={Boolean(reasonDrawer)}
        onClose={() => setReasonDrawer(null)}
        title={
          reasonDrawer?.type === "bundle"
            ? `${reasonDrawer.template.template_name} · 查看原因`
            : reasonDrawer?.type === "activity"
              ? `${reasonDrawer.activity.activity_name} · 查看原因`
              : "查看原因"
        }
      >
        {reasonDrawer?.type === "bundle" ? (
          <div className="space-y-4" data-testid="purchase-reason-drawer">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                {toBundleValueSummary(reasonDrawer.template)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                预计金额 {formatMoney(reasonDrawer.template.estimated_amount)} · 覆盖{" "}
                {reasonDrawer.template.items.length} 个 SKU
              </p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">SKU 明细</p>
              <div className="space-y-2">
                {reasonDrawer.template.items.map((item) => (
                  <div
                    key={item.sku_id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <Badge variant="secondary">{item.suggested_qty} 箱</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">{item.sku_id}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">业务解释</p>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {toBundleRationale(reasonDrawer.template)}
              </p>
            </section>
          </div>
        ) : null}

        {reasonDrawer?.type === "activity" ? (
          <div className="space-y-4" data-testid="purchase-reason-drawer">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                {toActivityValueSummary(reasonDrawer.activity)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                活动预计金额 {formatMoney(reasonDrawer.activity.estimated_amount)}
              </p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">SKU 明细</p>
              <div className="space-y-2">
                {reasonDrawer.activity.items.map((item) => (
                  <div
                    key={item.sku_id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <Badge variant="secondary">{item.suggested_qty} 箱</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">{item.sku_id}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">业务解释</p>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {reasonDrawer.activity.activity_notes[0] ||
                  "系统基于活动对象范围与档期优先级，组织本次活动备货商品。"}
              </p>
            </section>
          </div>
        ) : null}
      </ReasonDrawer>
    </div>
  );
}

function BundleTemplateCard(input: {
  template: BundleTemplate;
  busyKey: string;
  onAdd: () => void;
  onQuickOrder: () => void;
  onViewReason: () => void;
}) {
  const addBusy = input.busyKey === `bundle:add:${input.template.template_id}`;
  const quickBusy = input.busyKey === `bundle:quick:${input.template.template_id}`;

  return (
    <Card className="border-slate-200 bg-white/92">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg text-slate-900">{input.template.template_name}</CardTitle>
          <Badge variant="outline">
            {input.template.source === "published_recommendation" ? "已发布" : "回退候选"}
          </Badge>
        </div>
        <p className="text-sm text-slate-600">{input.template.template_subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-500">模板预计金额</p>
          <p className="mt-1 font-semibold text-slate-900">
            {formatMoney(input.template.estimated_amount)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <p className="text-slate-500">SKU 数</p>
          <p className="mt-1 font-semibold text-slate-900">{input.template.items.length} 个</p>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {toBundleValueSummary(input.template)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs text-slate-600">
            该卡片仅展示组货模板摘要；SKU 与解释请通过「查看原因」查看。
          </p>
        </div>
        <div className="grid gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={addBusy || quickBusy || input.template.items.length === 0}
            onClick={input.onAdd}
          >
            {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            加入采购清单
          </Button>
          <Button
            size="sm"
            disabled={addBusy || quickBusy || input.template.items.length === 0}
            onClick={input.onQuickOrder}
          >
            {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            快速下单
          </Button>
          <Button size="sm" variant="ghost" onClick={input.onViewReason}>
            查看原因
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard(input: {
  activity: ActivityHighlight;
  busy: boolean;
  onQuickOrder: () => void;
  onViewReason: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{input.activity.activity_name}</p>
          <p className="text-xs text-slate-500">
            {input.activity.week_id} · 门槛 {formatMoney(input.activity.promo_threshold)}
          </p>
        </div>
        <Badge variant="outline">{input.activity.promo_type}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-700">
        门槛达成收益优先，建议本次补齐 {input.activity.items.length} 个活动 SKU。
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {input.activity.activity_notes[0] || "按活动目标客户与商品范围进行备货。"}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm text-slate-700">活动预计金额：{formatMoney(input.activity.estimated_amount)}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={input.onViewReason}>
            查看原因
          </Button>
          <Button size="sm" onClick={input.onQuickOrder} disabled={input.busy || input.activity.items.length === 0}>
            {input.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            快速下单
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReasonDrawer(input: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!input.open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [input.open]);

  if (!input.open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="关闭原因抽屉"
        onClick={input.onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{input.title}</h2>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={input.onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto p-5">{input.children}</div>
      </aside>
    </div>,
    document.body,
  );
}
