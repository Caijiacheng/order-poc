"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleHelp, Loader2, ShoppingCart, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  requestExplain,
  type RecommendationCardItem,
} from "@/lib/frontstage/api";
import type {
  CartSession,
  DealerEntity,
  ProductEntity,
  SuggestionScene,
} from "@/lib/memory/types";

type SceneBlock = {
  title: string;
  scene: SuggestionScene;
  items: RecommendationCardItem[];
};

export default function ProcurementPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [loadingPage, setLoadingPage] = useState(true);
  const [refreshingRecommendations, setRefreshingRecommendations] = useState(false);
  const [busyAddAll, setBusyAddAll] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [busyExplainKey, setBusyExplainKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [recommendations, setRecommendations] = useState<Awaited<
    ReturnType<typeof createRecommendations>
  > | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, { title: string; content: string }>
  >({});

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
      .filter((product): product is ProductEntity => Boolean(product));
  }, [currentDealer, productMap]);
  const weeklyFocusProducts = useMemo(
    () => products.filter((product) => product.is_weekly_focus).slice(0, 4),
    [products],
  );

  const sceneBlocks: SceneBlock[] = recommendations
    ? [
        {
          title: "今日待补货",
          scene: "daily_recommendation",
          items: recommendations.dailyRecommendations,
        },
        {
          title: "本周活动专区",
          scene: "weekly_focus",
          items: recommendations.weeklyFocusRecommendations,
        },
      ]
    : [];

  const lastOrder =
    cart && cart.submitted_orders.length > 0
      ? cart.submitted_orders[cart.submitted_orders.length - 1]
      : null;

  const reloadCart = async () => {
    const nextCart = await fetchCart();
    setCart(nextCart);
  };

  const handleRefreshRecommendations = async () => {
    if (!dealerId) {
      setErrorMessage("请先选择经销商。");
      return;
    }

    setRefreshingRecommendations(true);
    setErrorMessage("");
    setSuccessMessage("");
    setExplanations({});
    try {
      const result = await createRecommendations({
        customerId: dealerId,
        triggerSource: "manual",
        pageName: "/procurement",
      });
      setRecommendations(result);
      setSuccessMessage("采购建议已刷新，可直接查看原因并加入采购清单。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新采购建议失败");
    } finally {
      setRefreshingRecommendations(false);
    }
  };

  const handleAddSingle = async (item: RecommendationCardItem) => {
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
      setSuccessMessage(`已加入采购清单：${item.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入采购清单失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleAddFrequent = async (product: ProductEntity) => {
    setBusyActionKey(product.sku_id);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        source: "manual",
        sku_id: product.sku_id,
        qty: Math.max(1, product.box_multiple),
      });
      await reloadCart();
      setSuccessMessage(`已加购常购商品：${product.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "常购加购失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleAddAllRecommendations = async () => {
    if (!dealerId || !recommendations) {
      return;
    }
    const merged = [
      ...recommendations.dailyRecommendations,
      ...recommendations.weeklyFocusRecommendations,
    ];
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
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已批量加入 ${count} 条采购建议。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批量加入采购清单失败");
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

  return (
    <div className="space-y-6" data-testid="procurement-home">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-slate-200 bg-white/92">
          <CardHeader className="space-y-3">
            <Badge className="w-fit rounded-full px-3 py-1">采购首页</Badge>
            <CardTitle className="text-3xl leading-tight text-slate-950">
              今日采购任务
            </CardTitle>
            <p className="text-sm leading-6 text-slate-600">
              先看待补货与活动建议，再进入商品选购完成加购，最后在采购清单做订单校正。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Demo Mode · 经销商切换
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
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
                <Button
                  variant="outline"
                  onClick={handleRefreshRecommendations}
                  disabled={refreshingRecommendations || !dealerId}
                >
                  {refreshingRecommendations ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  刷新采购建议
                </Button>
                <Button
                  onClick={handleAddAllRecommendations}
                  disabled={busyAddAll || !recommendations}
                >
                  {busyAddAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                  一键加入建议
                </Button>
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
                {formatMoney(cart?.summary.total_amount ?? 0)} /{" "}
                {formatMoney(cart?.summary.threshold_amount ?? 0)}
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
        <RecommendationBlock
          title="今日待补货"
          scene="daily_recommendation"
          items={sceneBlocks.find((item) => item.scene === "daily_recommendation")?.items ?? []}
          emptyText="暂无待补货建议，可先刷新采购建议。"
          testId="replenishment-module"
          explanations={explanations}
          busyExplainKey={busyExplainKey}
          busyActionKey={busyActionKey}
          onExplain={handleExplain}
          onAdd={handleAddSingle}
        />

        <Card className="border-slate-200 bg-white/92" data-testid="campaign-module">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">本周活动专区</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sceneBlocks.find((item) => item.scene === "weekly_focus")?.items.length ? (
              <RecommendationBlockBody
                scene="weekly_focus"
                items={sceneBlocks.find((item) => item.scene === "weekly_focus")?.items ?? []}
                explanations={explanations}
                busyExplainKey={busyExplainKey}
                busyActionKey={busyActionKey}
                onExplain={handleExplain}
                onAdd={handleAddSingle}
              />
            ) : weeklyFocusProducts.length > 0 ? (
              weeklyFocusProducts.map((product) => (
                <div
                  key={product.sku_id}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{product.sku_name}</p>
                      <p className="font-mono text-xs text-slate-500">{product.sku_id}</p>
                    </div>
                    <Badge variant="secondary">活动主推</Badge>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleAddFrequent(product)}
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
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                暂无活动商品，后续可在后台活动策略中维护。
              </div>
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
                      <p className="text-xs text-slate-500">
                        建议整箱起订：{product.box_multiple} 箱
                      </p>
                    </div>
                    <Badge variant="outline">{formatMoney(product.price_per_case)}/箱</Badge>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleAddFrequent(product)}
                      disabled={busyActionKey === product.sku_id}
                    >
                      {busyActionKey === product.sku_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="h-4 w-4" />
                      )}
                      常购加购
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
                  {new Date(lastOrder.submitted_at).toLocaleString("zh-CN")} ·{" "}
                  {formatMoney(lastOrder.total_amount)} · {lastOrder.item_count} 件
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                暂无已提交订单。可先完成一次采购闭环后再使用“再来一单”。
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="font-medium text-slate-900">复购入口</p>
              <p className="mt-1 text-slate-600">
                你可以在商品选购页按常购与活动视角快速补齐本轮采购。
              </p>
              <div className="mt-3">
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

function RecommendationBlock(input: {
  title: string;
  scene: SuggestionScene;
  items: RecommendationCardItem[];
  emptyText: string;
  testId?: string;
  explanations: Record<string, { title: string; content: string }>;
  busyExplainKey: string;
  busyActionKey: string;
  onExplain: (scene: SuggestionScene, item: RecommendationCardItem) => void;
  onAdd: (item: RecommendationCardItem) => void;
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
          <RecommendationBlockBody
            scene={input.scene}
            items={input.items}
            explanations={input.explanations}
            busyExplainKey={input.busyExplainKey}
            busyActionKey={input.busyActionKey}
            onExplain={input.onExplain}
            onAdd={input.onAdd}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationBlockBody(input: {
  scene: SuggestionScene;
  items: RecommendationCardItem[];
  explanations: Record<string, { title: string; content: string }>;
  busyExplainKey: string;
  busyActionKey: string;
  onExplain: (scene: SuggestionScene, item: RecommendationCardItem) => void;
  onAdd: (item: RecommendationCardItem) => void;
}) {
  return (
    <>
      {input.items.map((item) => {
        const explainKey = `${input.scene}:${item.sku_id}`;
        const busyKey = item.recommendation_item_id || item.sku_id;
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => input.onExplain(input.scene, item)}
                disabled={input.busyExplainKey === explainKey}
              >
                {input.busyExplainKey === explainKey ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CircleHelp className="h-4 w-4" />
                )}
                查看原因
              </Button>
              <Button
                size="sm"
                onClick={() => input.onAdd(item)}
                disabled={input.busyActionKey === busyKey}
              >
                {input.busyActionKey === busyKey ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                加入采购清单
              </Button>
            </div>
            {explainData ? (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                <p className="font-medium">{explainData.title}</p>
                <p className="mt-1 leading-6">{explainData.content}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
