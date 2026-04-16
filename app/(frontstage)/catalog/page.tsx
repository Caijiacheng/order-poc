"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ShoppingCart, Sparkles } from "lucide-react";

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
  createRecommendations,
  fetchActiveDealers,
  fetchActiveProducts,
  fetchCart,
  formatMoney,
  type RecommendationCardItem,
} from "@/lib/frontstage/api";
import type { CartSession, DealerEntity, ProductEntity } from "@/lib/memory/types";

type ProcurementView = "all" | "frequent" | "replenishment" | "campaign" | "new";

const VIEW_OPTIONS: Array<{ key: ProcurementView; label: string }> = [
  { key: "all", label: "全部商品" },
  { key: "frequent", label: "常购" },
  { key: "replenishment", label: "待补货" },
  { key: "campaign", label: "活动" },
  { key: "new", label: "新品" },
];

export default function CatalogPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<ProcurementView>("all");
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingHints, setLoadingHints] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [busyApplyHints, setBusyApplyHints] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [hintRecommendations, setHintRecommendations] = useState<RecommendationCardItem[]>(
    [],
  );

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
        setDealerId((prev) => prev || cartSession.customer_id || dealerList[0]?.customer_id || "");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载商品选购页失败");
      } finally {
        setLoadingPage(false);
      }
    };

    void bootstrap();
  }, []);

  const currentDealer = dealers.find((item) => item.customer_id === dealerId) ?? null;
  const frequentSet = useMemo(
    () => new Set(currentDealer?.frequent_items ?? []),
    [currentDealer],
  );
  const replenishmentSet = useMemo(
    () =>
      new Set(
        hintRecommendations
          .filter((item) => item.reason_tags.includes("补货周期"))
          .map((item) => item.sku_id),
      ),
    [hintRecommendations],
  );
  const hintSkuSet = useMemo(
    () => new Set(hintRecommendations.map((item) => item.sku_id)),
    [hintRecommendations],
  );
  const cartSkuSet = useMemo(
    () => new Set((cart?.items ?? []).map((item) => item.sku_id)),
    [cart],
  );

  const categories = Array.from(new Set(products.map((item) => item.category)));
  const filteredProducts = products.filter((product) => {
    const q = searchText.trim().toLowerCase();
    const matchQ =
      q.length === 0 ||
      product.sku_name.toLowerCase().includes(q) ||
      product.sku_id.toLowerCase().includes(q) ||
      product.tags.join(" ").toLowerCase().includes(q);
    const matchCategory = categoryFilter === "all" || product.category === categoryFilter;

    let matchView = true;
    if (viewFilter === "frequent") {
      matchView = frequentSet.has(product.sku_id);
    } else if (viewFilter === "replenishment") {
      matchView = replenishmentSet.has(product.sku_id);
    } else if (viewFilter === "campaign") {
      matchView = product.is_weekly_focus;
    } else if (viewFilter === "new") {
      matchView = product.is_new_product;
    }

    return matchQ && matchCategory && matchView;
  });

  const reloadCart = async () => {
    const cartSession = await fetchCart();
    setCart(cartSession);
  };

  const addManualItem = async (product: ProductEntity) => {
    const qtyValue = Number(qtyDraft[product.sku_id] || "1");
    const qty = Number.isFinite(qtyValue) && qtyValue > 0 ? Math.floor(qtyValue) : 1;
    setBusyActionKey(product.sku_id);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        sku_id: product.sku_id,
        qty,
        source: "manual",
      });
      await reloadCart();
      setSuccessMessage(`已加入：${product.sku_name} × ${qty}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入采购清单失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const refreshHints = async () => {
    if (!dealerId) {
      setErrorMessage("请先选择经销商。");
      return;
    }
    setLoadingHints(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await createRecommendations({
        customerId: dealerId,
        triggerSource: "manual",
        pageName: "/catalog",
      });
      const merged = [...result.dailyRecommendations, ...result.weeklyFocusRecommendations];
      setHintRecommendations(merged);
      setSuccessMessage("已刷新待补货与活动提示。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新提示失败");
    } finally {
      setLoadingHints(false);
    }
  };

  const applyHintItem = async (item: RecommendationCardItem) => {
    const actionKey = item.recommendation_item_id || item.sku_id;
    setBusyActionKey(actionKey);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        source: "recommendation",
        recommendation_item_id: item.recommendation_item_id,
        sku_id: item.sku_id,
        qty: item.suggested_qty,
      });
      await reloadCart();
      setSuccessMessage(`已采纳提示：${item.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "采纳提示失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const applyAllHints = async () => {
    if (hintRecommendations.length === 0) {
      return;
    }

    setBusyApplyHints(true);
    setErrorMessage("");
    setSuccessMessage("");
    let count = 0;
    try {
      for (const item of hintRecommendations) {
        await addCartItem({
          customerId: dealerId || undefined,
          source: "recommendation",
          recommendation_item_id: item.recommendation_item_id,
          sku_id: item.sku_id,
          qty: item.suggested_qty,
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已批量采纳 ${count} 条提示。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批量采纳失败");
    } finally {
      setBusyApplyHints(false);
    }
  };

  const missingFrequentCount = Array.from(frequentSet).filter((sku) => !cartSkuSet.has(sku)).length;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Badge className="rounded-full px-3 py-1">商品选购</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">采购工作台</h1>
        <p className="text-sm text-slate-600">
          按采购视角筛选商品，快速加购并实时查看采购清单进度。
        </p>
      </section>

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

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-slate-200 bg-white/92">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-xl text-slate-900">商品选购区</CardTitle>
              <Button variant="outline" onClick={refreshHints} disabled={loadingHints || !dealerId}>
                {loadingHints ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                刷新待补货提示
              </Button>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Demo Mode · 经销商切换
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
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
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {VIEW_OPTIONS.map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={viewFilter === option.key ? "default" : "outline"}
                  onClick={() => setViewFilter(option.key)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3" data-testid="catalog-grid">
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
              filteredProducts.map((product) => {
                const isHinted = hintSkuSet.has(product.sku_id);
                return (
                  <div key={product.sku_id} className="rounded-xl border border-slate-200 bg-white p-3">
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
                      {frequentSet.has(product.sku_id) ? <Badge variant="outline">常购</Badge> : null}
                      {isHinted ? <Badge variant="outline">建议补货</Badge> : null}
                      {product.is_weekly_focus ? <Badge variant="outline">活动</Badge> : null}
                      {product.is_new_product ? <Badge variant="outline">新品</Badge> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-24"
                        value={qtyDraft[product.sku_id] ?? "1"}
                        onChange={(event) =>
                          setQtyDraft((prev) => ({ ...prev, [product.sku_id]: event.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        onClick={() => addManualItem(product)}
                        disabled={busyActionKey === product.sku_id}
                      >
                        {busyActionKey === product.sku_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShoppingCart className="h-4 w-4" />
                        )}
                        加入采购清单
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="border-slate-200 bg-gradient-to-b from-slate-50 to-white">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900">采购清单（右侧摘要）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">当前经销商</p>
                <p className="mt-1 font-medium text-slate-900">
                  {currentDealer?.customer_name ?? "未选择"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">SKU / 件数</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {cart?.summary.sku_count ?? 0} / {cart?.summary.item_count ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">金额 / 门槛</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {formatMoney(cart?.summary.total_amount ?? 0)} /{" "}
                  {formatMoney(cart?.summary.threshold_amount ?? 0)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {cart?.summary.threshold_reached
                    ? "已达到门槛"
                    : `距门槛还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)}`}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600">
                常购待补货：{missingFrequentCount} 项
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/basket">去采购清单</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/procurement">返回采购首页</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/92">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg text-slate-900">系统补货提示</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyAllHints}
                  disabled={busyApplyHints || hintRecommendations.length === 0}
                >
                  {busyApplyHints ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  批量采纳
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {hintRecommendations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                  点击“刷新待补货提示”获取建议商品。
                </div>
              ) : (
                hintRecommendations.slice(0, 5).map((item) => {
                  const actionKey = item.recommendation_item_id || item.sku_id;
                  return (
                    <div key={actionKey} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-500">建议 {item.suggested_qty} 箱</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => applyHintItem(item)}
                          disabled={busyActionKey === actionKey}
                        >
                          采纳
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
