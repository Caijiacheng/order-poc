"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleHelp, Loader2, ShoppingCart } from "lucide-react";

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
  fetchPublishedSuggestions,
  fetchActiveDealers,
  fetchActiveProducts,
  fetchCart,
  formatMoney,
  patchCartItem,
  requestExplain,
  type RecommendationCardItem,
} from "@/lib/frontstage/api";
import type {
  CartSession,
  DealerEntity,
  ProductEntity,
  SuggestionScene,
} from "@/lib/memory/types";

type RecommendationsState = Awaited<ReturnType<typeof fetchPublishedSuggestions>>;

export default function ProcurementPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [busyAddAll, setBusyAddAll] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [busyExplainKey, setBusyExplainKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [recommendations, setRecommendations] = useState<RecommendationsState | null>(null);
  const [explanations, setExplanations] = useState<Record<string, { title: string; content: string }>>({});
  const [qtyDraftByKey, setQtyDraftByKey] = useState<Record<string, string>>({});

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
        setErrorMessage(error instanceof Error ? error.message : "加载采购首页失败");
      } finally {
        setLoadingPage(false);
      }
    };

    void bootstrap();
  }, []);

  const currentDealer = dealers.find((dealer) => dealer.customer_id === dealerId) ?? null;
  const productMap = useMemo(
    () => new Map(products.map((product) => [product.sku_id, product])),
    [products],
  );
  const frequentProducts = useMemo(() => {
    if (!currentDealer) {
      return [] as ProductEntity[];
    }
    return currentDealer.frequent_items
      .map((skuId) => productMap.get(skuId))
      .filter((item): item is ProductEntity => Boolean(item));
  }, [currentDealer, productMap]);
  const hotSellingProducts = useMemo(() => {
    const frequentSet = new Set(frequentProducts.map((item) => item.sku_id));
    const hotCandidates = products.filter((item) =>
      item.tags.some((tag) => tag.includes("高频") || tag.includes("高客单")),
    );
    return hotCandidates
      .sort((left, right) => Number(frequentSet.has(right.sku_id)) - Number(frequentSet.has(left.sku_id)))
      .slice(0, 4);
  }, [frequentProducts, products]);

  const lastOrder =
    cart && cart.submitted_orders.length > 0
      ? cart.submitted_orders[cart.submitted_orders.length - 1]
      : null;

  const dailyRecommendations = recommendations?.dailyRecommendations ?? [];
  const weeklyRecommendations = recommendations?.weeklyFocusRecommendations ?? [];

  const reloadCart = useCallback(async () => {
    const nextCart = await fetchCart();
    setCart(nextCart);
  }, []);

  const loadRecommendations = useCallback(
    async (customerId: string) => {
      setLoadingRecommendations(true);
      setErrorMessage("");
      try {
        const result = await fetchPublishedSuggestions(customerId);
        setRecommendations(result);
        setQtyDraftByKey((prev) => {
          const next = { ...prev };
          for (const item of [...result.dailyRecommendations, ...result.weeklyFocusRecommendations]) {
            const key = item.recommendation_item_id || item.sku_id;
            if (!next[key]) {
              next[key] = String(item.suggested_qty);
            }
          }
          return next;
        });
        setSuccessMessage(
          result.summary.published
            ? "已加载当前已发布建议单，可直接采纳、改量或忽略。"
            : "当前暂无已发布建议单，可先使用常购快捷补货或热销补货。",
        );
      } catch (error) {
        setRecommendations(null);
        setErrorMessage(error instanceof Error ? error.message : "加载已发布建议单失败");
      } finally {
        setLoadingRecommendations(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!dealerId) {
      return;
    }
    setRecommendations(null);
    setExplanations({});
    void loadRecommendations(dealerId);
  }, [dealerId, loadRecommendations]);

  const handleAddProduct = async (product: ProductEntity, qty: number, source: "manual" | "recommendation") => {
    setBusyActionKey(product.sku_id);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        sku_id: product.sku_id,
        qty: Math.max(1, qty),
        source,
      });
      await reloadCart();
      setSuccessMessage(`已加入采购清单：${product.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入采购清单失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleApplyRecommendation = async (scene: SuggestionScene, item: RecommendationCardItem) => {
    const actionKey = item.recommendation_item_id || `${scene}:${item.sku_id}`;
    const desiredQty = Number.parseInt(qtyDraftByKey[actionKey] ?? String(item.suggested_qty), 10);
    const safeQty = Number.isFinite(desiredQty) && desiredQty > 0 ? desiredQty : item.suggested_qty;
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
        lifecycle_action: "apply",
      });
      if (safeQty !== item.suggested_qty) {
        await patchCartItem({
          skuId: item.sku_id,
          qty: safeQty,
          recommendation_item_id: item.recommendation_item_id,
        });
      }
      await reloadCart();
      setSuccessMessage(`已采纳建议：${item.sku_name} × ${safeQty}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "采纳建议失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleIgnoreRecommendation = async (scene: SuggestionScene, item: RecommendationCardItem) => {
    if (!item.recommendation_item_id) {
      return;
    }
    const actionKey = `ignore:${scene}:${item.recommendation_item_id}`;
    setBusyActionKey(actionKey);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        source: "recommendation",
        recommendation_item_id: item.recommendation_item_id,
        lifecycle_action: "ignore",
      });
      setRecommendations((prev) => {
        if (!prev) {
          return prev;
        }
        const remove = (list: RecommendationCardItem[]) =>
          list.filter((entry) => entry.recommendation_item_id !== item.recommendation_item_id);
        return {
          ...prev,
          dailyRecommendations:
            scene === "daily_recommendation" ? remove(prev.dailyRecommendations) : prev.dailyRecommendations,
          weeklyFocusRecommendations:
            scene === "weekly_focus" ? remove(prev.weeklyFocusRecommendations) : prev.weeklyFocusRecommendations,
        };
      });
      setSuccessMessage(`已忽略建议：${item.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "忽略建议失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleAddAllRecommendations = async () => {
    if (!recommendations || !dealerId) {
      return;
    }
    const merged = [...recommendations.dailyRecommendations, ...recommendations.weeklyFocusRecommendations];
    if (merged.length === 0) {
      return;
    }
    setBusyAddAll(true);
    setErrorMessage("");
    setSuccessMessage("");
    let count = 0;
    try {
      for (const item of merged) {
        await addCartItem({
          customerId: dealerId,
          source: "recommendation",
          recommendation_item_id: item.recommendation_item_id,
          sku_id: item.sku_id,
          qty: item.suggested_qty,
          lifecycle_action: "apply",
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已一键采纳 ${count} 条建议。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "一键采纳失败");
    } finally {
      setBusyAddAll(false);
    }
  };

  const handleExplain = async (scene: SuggestionScene, item: RecommendationCardItem) => {
    if (!dealerId) {
      return;
    }
    const explainKey = `${scene}:${item.sku_id}`;
    setBusyExplainKey(explainKey);
    setErrorMessage("");
    try {
      const result = await requestExplain({
        customerId: dealerId,
        scene,
        targetItemIds: [item.sku_id],
      });
      setExplanations((prev) => ({
        ...prev,
        [explainKey]: {
          title: result.title,
          content: result.content,
        },
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "获取推荐原因失败");
    } finally {
      setBusyExplainKey("");
    }
  };

  const handleRepeatLastOrder = async () => {
    if (!dealerId || frequentProducts.length === 0) {
      return;
    }
    setBusyActionKey("repeat-last-order");
    setErrorMessage("");
    setSuccessMessage("");
    let count = 0;
    try {
      const topItems = frequentProducts.slice(0, Math.min(4, Math.max(lastOrder?.item_count ?? 2, 2)));
      for (const product of topItems) {
        await addCartItem({
          customerId: dealerId,
          source: "manual",
          sku_id: product.sku_id,
          qty: Math.max(1, product.box_multiple),
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已按“再来一单”快速补入 ${count} 个常购 SKU。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "执行再来一单失败");
    } finally {
      setBusyActionKey("");
    }
  };

  return (
    <div className="space-y-6" data-testid="procurement-home">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-slate-200 bg-white/92">
          <CardHeader className="space-y-3">
            <Badge className="w-fit rounded-full px-3 py-1">采购首页</Badge>
            <CardTitle className="text-3xl leading-tight text-slate-950">
              系统已准备好今日建议单
            </CardTitle>
            <p className="text-sm leading-6 text-slate-600">
              今日建议单由系统提前生成，你可以直接采纳、改量、忽略并查看业务原因。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Demo Mode · 经销商切换
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
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
                <Button onClick={handleAddAllRecommendations} disabled={busyAddAll || !recommendations}>
                  {busyAddAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                  一键采纳建议单
                </Button>
              </div>
            </div>

            {currentDealer ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-medium text-slate-900">{currentDealer.customer_name}</p>
                <p className="mt-1 text-slate-600">
                  {currentDealer.city} · {currentDealer.customer_type} · 下单频次 {currentDealer.order_frequency}
                </p>
              </div>
            ) : null}

            {loadingRecommendations ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                正在同步今日建议单...
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

        <Card className="h-fit border-slate-200 bg-gradient-to-b from-slate-50 to-white">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">采购清单摘要</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-slate-500">SKU / 件数</p>
              <p className="kpi-value mt-1 text-lg text-slate-900">
                {cart?.summary.sku_count ?? 0} / {cart?.summary.item_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-slate-500">采购金额 / 门槛</p>
              <p className="kpi-value mt-1 text-lg text-slate-900">
                {formatMoney(cart?.summary.total_amount ?? 0)} / {formatMoney(cart?.summary.threshold_amount ?? 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {cart?.summary.threshold_reached
                  ? "已达到门槛，可进入下单确认"
                  : `距门槛还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/catalog">去商品选购</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/basket">查看采购清单</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RecommendationCard
          title="今日建议单"
          scene="daily_recommendation"
          items={dailyRecommendations}
          emptyText="今日暂无待补货建议。"
          testId="replenishment-module"
          qtyDraftByKey={qtyDraftByKey}
          explanations={explanations}
          busyExplainKey={busyExplainKey}
          busyActionKey={busyActionKey}
          onQtyChange={(key, value) =>
            setQtyDraftByKey((prev) => ({
              ...prev,
              [key]: value,
            }))
          }
          onExplain={handleExplain}
          onApply={handleApplyRecommendation}
          onIgnore={handleIgnoreRecommendation}
        />

        <RecommendationCard
          title="本周活动备货"
          scene="weekly_focus"
          items={weeklyRecommendations}
          emptyText="当前暂无活动备货建议。"
          testId="campaign-module"
          qtyDraftByKey={qtyDraftByKey}
          explanations={explanations}
          busyExplainKey={busyExplainKey}
          busyActionKey={busyActionKey}
          onQtyChange={(key, value) =>
            setQtyDraftByKey((prev) => ({
              ...prev,
              [key]: value,
            }))
          }
          onExplain={handleExplain}
          onApply={handleApplyRecommendation}
          onIgnore={handleIgnoreRecommendation}
        />

        <Card className="border-slate-200 bg-white/92">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">热销补货</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hotSellingProducts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                当前热销池为空，请在运营侧补充热销商品标签。
              </div>
            ) : (
              hotSellingProducts.map((product) => (
                <div key={product.sku_id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{product.sku_name}</p>
                      <p className="font-mono text-xs text-slate-500">{product.sku_id}</p>
                    </div>
                    <Badge variant="secondary">热销</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">建议整箱补货 {product.box_multiple} 箱</p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleAddProduct(product, Math.max(1, product.box_multiple), "recommendation")}
                      disabled={busyActionKey === product.sku_id}
                    >
                      {busyActionKey === product.sku_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                      采纳热销补货
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/92" data-testid="quick-reorder-module">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">常购快捷补货</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {frequentProducts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                当前经销商暂无常购清单。
              </div>
            ) : (
              frequentProducts.map((product) => (
                <div key={product.sku_id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{product.sku_name}</p>
                      <p className="text-xs text-slate-500">建议整箱起订：{product.box_multiple} 箱</p>
                    </div>
                    <Badge variant="outline">{formatMoney(product.price_per_case)}/箱</Badge>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleAddProduct(product, Math.max(1, product.box_multiple), "manual")}
                      disabled={busyActionKey === product.sku_id}
                    >
                      {busyActionKey === product.sku_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                      快速补货
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/92">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">上次订单再来一单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {lastOrder ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">最近一次提交订单</p>
                <p className="mt-1 text-slate-600">
                  {new Date(lastOrder.submitted_at).toLocaleString("zh-CN")} · {formatMoney(lastOrder.total_amount)} · {lastOrder.item_count} 件
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                暂无已提交订单，可先完成本轮采购后再使用复购功能。
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="font-medium text-slate-900">复购动作</p>
              <p className="mt-1 text-slate-600">按当前经销商常购结构，快速补齐一轮复购基础品。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={handleRepeatLastOrder} disabled={busyActionKey === "repeat-last-order" || frequentProducts.length === 0}>
                  {busyActionKey === "repeat-last-order" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                  一键复购
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/catalog">进入商品选购</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function RecommendationCard(input: {
  title: string;
  scene: SuggestionScene;
  items: RecommendationCardItem[];
  emptyText: string;
  testId?: string;
  qtyDraftByKey: Record<string, string>;
  explanations: Record<string, { title: string; content: string }>;
  busyExplainKey: string;
  busyActionKey: string;
  onQtyChange: (key: string, value: string) => void;
  onExplain: (scene: SuggestionScene, item: RecommendationCardItem) => void;
  onApply: (scene: SuggestionScene, item: RecommendationCardItem) => void;
  onIgnore: (scene: SuggestionScene, item: RecommendationCardItem) => void;
}) {
  return (
    <Card className="border-slate-200 bg-white/92" data-testid={input.testId}>
      <CardHeader>
        <CardTitle className="text-xl text-slate-900">{input.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {input.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {input.emptyText}
          </div>
        ) : (
          input.items.map((item) => {
            const explainKey = `${input.scene}:${item.sku_id}`;
            const actionKey = item.recommendation_item_id || `${input.scene}:${item.sku_id}`;
            const ignoreKey = `ignore:${input.scene}:${item.recommendation_item_id}`;
            const explainData = input.explanations[explainKey];
            return (
              <div key={`${input.scene}-${item.sku_id}`} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{item.sku_name}</p>
                    <p className="font-mono text-xs text-slate-500">{item.sku_id}</p>
                  </div>
                  <Badge variant="secondary">建议 {item.suggested_qty} 箱</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">{item.reason}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.reason_tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-full">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[100px_1fr]">
                  <Input
                    type="number"
                    min={1}
                    value={input.qtyDraftByKey[actionKey] ?? String(item.suggested_qty)}
                    onChange={(event) => input.onQtyChange(actionKey, event.target.value)}
                    aria-label={`${item.sku_name} 建议数量`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => input.onApply(input.scene, item)}
                      disabled={input.busyActionKey === actionKey}
                    >
                      {input.busyActionKey === actionKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                      采纳/改量
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => input.onIgnore(input.scene, item)}
                      disabled={!item.recommendation_item_id || input.busyActionKey === ignoreKey}
                    >
                      忽略
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => input.onExplain(input.scene, item)}
                      disabled={input.busyExplainKey === explainKey}
                    >
                      {input.busyExplainKey === explainKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleHelp className="h-4 w-4" />}
                      查看原因
                    </Button>
                  </div>
                </div>
                {explainData ? (
                  <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                    <p className="font-medium">{explainData.title}</p>
                    <p className="mt-1 leading-6">{explainData.content}</p>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
