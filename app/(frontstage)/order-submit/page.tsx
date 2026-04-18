"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShoppingCart, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  addCartItem,
  fetchActiveDealers,
  fetchActiveProducts,
  fetchCart,
  formatMoney,
  optimizeCart,
  patchCartItem,
  removeCartItem,
  submitCart,
  type CartOptimizationResponse,
} from "@/lib/frontstage/api";
import type {
  CartOptimizationRecommendationBar,
  CartSession,
  DealerEntity,
  ProductEntity,
} from "@/lib/memory/types";

function buildBarActionKey(bar: CartOptimizationRecommendationBar) {
  return `bar:${bar.bar_id}`;
}

function toDisplayNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

function toBarTypeLabel(barType: CartOptimizationRecommendationBar["bar_type"]) {
  if (barType === "threshold") {
    return "凑够起订额";
  }
  if (barType === "box_adjustment") {
    return "补齐整箱";
  }
  return "搭配补货";
}

function getBarAddedAmount(
  bar: CartOptimizationRecommendationBar,
  productMap: Map<string, ProductEntity>,
) {
  return bar.items.reduce((sum, item) => {
    const product = productMap.get(item.sku_id);
    if (!product) {
      return sum;
    }
    const qty =
      item.action_type === "adjust_qty"
        ? Math.max(0, (item.to_qty ?? item.suggested_qty) - (item.from_qty ?? 0))
        : item.suggested_qty;
    return sum + qty * product.price_per_case;
  }, 0);
}

function getPairingAnchorNames(input: {
  bar: CartOptimizationRecommendationBar;
  cart: CartSession | null;
  productMap: Map<string, ProductEntity>;
}) {
  const { bar, cart, productMap } = input;
  if (!cart || bar.bar_type !== "pairing") {
    return [];
  }
  const suggestedSkuSet = new Set(bar.items.map((item) => item.sku_id));
  const targetSkuIds = bar.items.map((item) => item.sku_id);
  return cart.items
    .filter((cartItem) => !suggestedSkuSet.has(cartItem.sku_id))
    .filter((cartItem) => {
      const product = productMap.get(cartItem.sku_id);
      if (!product) {
        return false;
      }
      return targetSkuIds.some((skuId) => product.pair_items.includes(skuId));
    })
    .map((cartItem) => cartItem.sku_name);
}

function buildBarCustomerSummary(input: {
  bar: CartOptimizationRecommendationBar;
  cart: CartSession | null;
  dealer: DealerEntity | null;
  productMap: Map<string, ProductEntity>;
}) {
  const { bar, cart, dealer, productMap } = input;
  const addedAmount = getBarAddedAmount(bar, productMap);
  const firstItem = bar.items[0];
  const anchorNames = getPairingAnchorNames({ bar, cart, productMap });

  if (bar.bar_type === "threshold") {
    return `再带上这组约 ${formatMoney(addedAmount)}，这单更容易凑够起订额。`;
  }
  if (bar.bar_type === "box_adjustment") {
    if (bar.items.length === 1 && firstItem?.action_type === "adjust_qty") {
      const delta = Math.max(
        0,
        (firstItem.to_qty ?? firstItem.suggested_qty) - (firstItem.from_qty ?? 0),
      );
      return `${firstItem.sku_name} 再补 ${delta} 箱就正好整箱，收货更省事。`;
    }
    return "把这几款一起补到整箱，后续收货和出货都更省事。";
  }
  if (anchorNames.length > 0) {
    return `你这单里已经有 ${anchorNames.slice(0, 2).join("、")}，这次一起补上更容易一次备齐。`;
  }
  if (dealer && firstItem && dealer.frequent_items.includes(firstItem.sku_id)) {
    return `${firstItem.sku_name} 本身就是门店常带商品，这次一起补上更稳妥。`;
  }
  return `这款和你这单里的商品搭配更完整，一起补上能少跑一趟补货。`;
}

function buildBarEvidence(input: {
  bar: CartOptimizationRecommendationBar;
  cart: CartSession | null;
  dealer: DealerEntity | null;
  productMap: Map<string, ProductEntity>;
}) {
  const { bar, cart, dealer, productMap } = input;
  const addedAmount = getBarAddedAmount(bar, productMap);
  const anchorNames = getPairingAnchorNames({ bar, cart, productMap });
  const frequentNames =
    cart && dealer
      ? cart.items
          .filter((item) => dealer.frequent_items.includes(item.sku_id))
          .map((item) => item.sku_name)
      : [];

  if (bar.bar_type === "threshold") {
    return [
      `当前这单金额 ${formatMoney(cart?.summary.total_amount ?? 0)}，离起订额还差 ${formatMoney(
        cart?.summary.gap_to_threshold ?? 0,
      )}`,
      `这组建议预计再增加 ${formatMoney(addedAmount)}`,
      dealer ? `按门店平时 ${dealer.order_frequency} 的进货节奏，这次一起带上更省一次补货。` : "",
    ].filter(Boolean);
  }

  if (bar.bar_type === "box_adjustment") {
    return bar.items.map((item) => {
      const fromQty = item.from_qty ?? 0;
      const toQty = item.to_qty ?? item.suggested_qty;
      return `${item.sku_name} 当前 ${fromQty} 箱，补到 ${toQty} 箱正好整箱。`;
    });
  }

  return [
    anchorNames.length > 0 ? `你这单里已选：${anchorNames.slice(0, 3).join("、")}` : "",
    frequentNames.length > 0 ? `门店常买：${frequentNames.slice(0, 3).join("、")}` : "",
    `这次一起补约 ${formatMoney(addedAmount)}`,
  ].filter(Boolean);
}

export default function OrderSubmitPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [optimization, setOptimization] = useState<CartOptimizationResponse | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [loadingPage, setLoadingPage] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [openedBarId, setOpenedBarId] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<{
    order_id: string;
    submitted_at: string;
    total_amount: number;
    item_count: number;
  } | null>(null);
  const latestOptimizationToken = useRef(0);

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
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载确认下单页面失败");
      } finally {
        setLoadingPage(false);
      }
    };

    void bootstrap();
  }, []);

  const currentDealer = useMemo(() => {
    if (!cart?.customer_id) {
      return null;
    }
    return dealers.find((dealer) => dealer.customer_id === cart.customer_id) ?? null;
  }, [cart?.customer_id, dealers]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.sku_id, product])),
    [products],
  );

  const cartSignature = useMemo(() => {
    if (!cart || cart.items.length === 0) {
      return "";
    }
    return cart.items
      .map((item) => `${item.sku_id}:${item.qty}`)
      .sort()
      .join("|");
  }, [cart]);

  const reloadCart = async () => {
    const nextCart = await fetchCart();
    setCart(nextCart);
    return nextCart;
  };

  const recomputeOptimization = useEffectEvent(
    async (nextCart: CartSession, options?: { silent?: boolean }) => {
      if (nextCart.items.length === 0) {
        setOptimization(null);
        return;
      }

      const token = Date.now();
      latestOptimizationToken.current = token;
      setOptimizing(true);
      if (!options?.silent) {
        setErrorMessage("");
        setSuccessMessage("");
      }

      try {
        const result = await optimizeCart(nextCart.customer_id);
        if (latestOptimizationToken.current !== token) {
          return;
        }
        setOptimization(result);
        if (!options?.silent) {
          setSuccessMessage("补货建议已按最新购物车更新。");
        }
      } catch (error) {
        if (latestOptimizationToken.current !== token) {
          return;
        }
        setOptimization(null);
        setErrorMessage(error instanceof Error ? error.message : "自动计算凑单推荐失败");
      } finally {
        if (latestOptimizationToken.current === token) {
          setOptimizing(false);
        }
      }
    },
  );

  useEffect(() => {
    if (loadingPage || !cart) {
      return;
    }
    if (cart.items.length === 0) {
      setOptimization(null);
      return;
    }
    void recomputeOptimization(cart, { silent: true });
  }, [cart, cartSignature, loadingPage]);

  const updateItemQty = async (skuId: string) => {
    const currentRow = cart?.items.find((item) => item.sku_id === skuId);
    if (!currentRow) {
      return;
    }
    const rawDraft = qtyDraft[skuId];
    if (typeof rawDraft !== "string" || rawDraft.trim() === "") {
      setQtyDraft((prev) => ({
        ...prev,
        [skuId]: String(currentRow.qty),
      }));
      return;
    }

    const qtyValue = Number(rawDraft);
    if (!Number.isFinite(qtyValue)) {
      return;
    }

    const qty = Math.floor(qtyValue);
    if (qty === currentRow.qty) {
      return;
    }
    setBusyActionKey(`patch:${skuId}`);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const itemName = currentRow.sku_name ?? "商品";
      const result = await patchCartItem({ skuId, qty });
      setCart(result.cart);
      setSuccessMessage(qty <= 0 ? `已移除 ${itemName}` : `已把 ${itemName} 调整为 ${qty} 箱`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "修改数量失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleRemoveItem = async (skuId: string) => {
    setBusyActionKey(`remove:${skuId}`);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const itemName = cart?.items.find((item) => item.sku_id === skuId)?.sku_name ?? "商品";
      const result = await removeCartItem(skuId);
      setCart(result.cart);
      setSuccessMessage(`已移除 ${itemName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除商品失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const applyRecommendationBar = async (bar: CartOptimizationRecommendationBar) => {
    setBusyActionKey(buildBarActionKey(bar));
    setErrorMessage("");
    setSuccessMessage("");
    try {
      for (const item of bar.items) {
        if (item.action_type === "adjust_qty") {
          await patchCartItem({
            skuId: item.sku_id,
            qty: item.to_qty ?? item.suggested_qty,
            recommendation_item_id: item.recommendation_item_id,
          });
        } else {
          await addCartItem({
            customerId: cart?.customer_id,
            source: "recommendation",
            recommendation_item_id: item.recommendation_item_id,
            sku_id: item.sku_id,
            qty: item.suggested_qty,
            lifecycle_action: "apply",
          });
        }
      }
      await reloadCart();
      setOpenedBarId(null);
      setSuccessMessage(`已采纳推荐：${bar.headline}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "应用推荐失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await submitCart();
      setSubmittedOrder(result.order);
      setCart(result.cart);
      setOptimization(null);
      setSuccessMessage("订单提交成功。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交订单失败");
    } finally {
      setSubmitting(false);
    }
  };

  const recommendationBars = optimization?.recommendationBars ?? [];
  const openedBar = recommendationBars.find((bar) => bar.bar_id === openedBarId) ?? null;

  return (
    <div className="space-y-6" data-testid="order-submit-workbench">
      <section className="space-y-3">
        <Badge className="rounded-full px-3 py-1">确认下单</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          确认商品并下单
        </h1>
        <p className="text-sm text-slate-600">
          确认这次要带的商品和箱数；如果金额还差一点，右侧会提示几款适合一起带上的商品。
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

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 bg-white/92">
          <CardHeader className="space-y-2">
            <CardTitle className="text-xl text-slate-900">购物车商品清单</CardTitle>
            <p className="text-sm text-slate-600">
              确认每款商品的箱数；改完数字后会自动保存，不需要的可以直接删掉。
            </p>
          </CardHeader>
          <CardContent>
            {loadingPage || !cart ? (
              <div className="py-10 text-center text-sm text-slate-500">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                正在加载购物车...
              </div>
            ) : cart.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                当前还没有选中商品，请先回到上一页继续选货。
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>序号</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">箱数</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.items.map((row, index) => (
                    <TableRow key={row.sku_id}>
                      <TableCell className="text-xs text-slate-500">
                        {toDisplayNumber(index)}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-900">{row.sku_name}</p>
                        {productMap.get(row.sku_id)?.spec ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {productMap.get(row.sku_id)?.spec}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(row.price_per_case)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="ml-auto flex w-[150px] items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={qtyDraft[row.sku_id] ?? String(row.qty)}
                            onChange={(event) =>
                              setQtyDraft((prev) => ({
                                ...prev,
                                [row.sku_id]: event.target.value,
                              }))
                            }
                            onBlur={() => void updateItemQty(row.sku_id)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") {
                                return;
                              }
                              event.preventDefault();
                              void updateItemQty(row.sku_id);
                              (event.currentTarget as HTMLInputElement).blur();
                            }}
                            aria-label={`${row.sku_name} 数量`}
                          />
                          {busyActionKey === `patch:${row.sku_id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleRemoveItem(row.sku_id)}
                          disabled={busyActionKey === `remove:${row.sku_id}`}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 bg-gradient-to-b from-slate-50 to-white" data-testid="order-submit-summary">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl text-slate-900">订单汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">当前门店</p>
                <p className="mt-1 font-medium text-slate-900">
                  {currentDealer?.customer_name ?? "未识别门店"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">本单金额 / 起订额</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {formatMoney(cart?.summary.total_amount ?? 0)} /{" "}
                  {formatMoney(cart?.summary.threshold_amount ?? 0)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {cart?.summary.threshold_reached
                    ? "已满足起订额，可以直接确认下单。"
                    : `还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)} 就到起订额`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/purchase">返回继续选品</Link>
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void handleSubmitOrder()}
                  disabled={submitting || !cart || cart.items.length === 0}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  提交订单
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/92" data-testid="order-submit-recommendation-bars">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl text-slate-900">凑单推荐</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {optimizing ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  正在刷新结算区推荐...
                </div>
              ) : null}
              {!cart || cart.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  购物车为空时不会显示凑单推荐。
                </div>
              ) : recommendationBars.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  当前购物车无需额外补货，可直接确认交易信息并提交订单。
                </div>
              ) : (
                recommendationBars.map((bar) => {
                  const firstItem = bar.items[0];
                  return (
                    <div key={bar.bar_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{bar.headline}</p>
                          <p className="mt-1 text-sm text-slate-700">
                            {buildBarCustomerSummary({
                              bar,
                              cart,
                              dealer: currentDealer,
                              productMap,
                            })}
                          </p>
                        </div>
                        <Badge variant="outline">{toBarTypeLabel(bar.bar_type)}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {bar.items.length === 1 && firstItem
                          ? `${firstItem.sku_name} · ${firstItem.action_type === "adjust_qty" ? `调整到 ${firstItem.to_qty ?? firstItem.suggested_qty} 箱` : `建议 ${firstItem.suggested_qty} 箱`}`
                          : `共 ${bar.items.length} 款商品一起带上`}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Button
                          size="sm"
                          onClick={() => void applyRecommendationBar(bar)}
                          disabled={busyActionKey === buildBarActionKey(bar)}
                        >
                          {busyActionKey === buildBarActionKey(bar) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShoppingCart className="h-4 w-4" />
                          )}
                          {bar.action_label}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenedBarId(bar.bar_id)}
                        >
                          查看依据
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/92">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl text-slate-900">交易信息</CardTitle>
              <p className="text-sm text-slate-600">
                确认收货、配送和结算信息后，就可以直接提交订单。
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-500">收货地址</p>
                  <p className="mt-1 font-medium text-slate-900">
                    厦门市思明区湖滨南路 68 号配送仓
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-500">配送方式</p>
                  <p className="mt-1 font-medium text-slate-900">整车配送 / 次日达</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-500">结算方式</p>
                  <p className="mt-1 font-medium text-slate-900">月结 30 天</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-500">发票信息</p>
                  <p className="mt-1 font-medium text-slate-900">增值税专票</p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900" htmlFor="order-note">
                  备注
                </label>
                <Textarea
                  id="order-note"
                  placeholder="可补充送货要求、陈列备注等"
                  value={orderNote}
                  onChange={(event) => setOrderNote(event.target.value)}
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {submittedOrder ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardHeader>
                <CardTitle className="text-lg text-emerald-900">提交成功</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-emerald-900">
                <p>订单号：{submittedOrder.order_id}</p>
                <p>提交时间：{submittedOrder.submitted_at}</p>
                <p>提交金额：{formatMoney(submittedOrder.total_amount)}</p>
                <p>商品件数：{submittedOrder.item_count}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <ReasonDrawer
        open={Boolean(openedBar)}
        title={openedBar?.headline ?? "推荐说明"}
        onClose={() => setOpenedBarId(null)}
      >
        {openedBar ? (
          <div className="space-y-4" data-testid="order-submit-reason-drawer">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                {buildBarCustomerSummary({
                  bar: openedBar,
                  cart,
                  dealer: currentDealer,
                  productMap,
                })}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                共 {openedBar.items.length} 款商品，预计增加{" "}
                {formatMoney(getBarAddedAmount(openedBar, productMap))}
              </p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">建议商品</p>
              <div className="space-y-2">
                {openedBar.items.map((item) => (
                  <div
                    key={`${openedBar.bar_id}_${item.sku_id}`}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <Badge variant="secondary">
                        {item.action_type === "adjust_qty"
                          ? `调整到 ${item.to_qty ?? item.suggested_qty} 箱`
                          : `${item.suggested_qty} 箱`}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">
                这次建议主要依据
              </p>
              <div className="mt-3 space-y-2">
                {buildBarEvidence({
                  bar: openedBar,
                  cart,
                  dealer: currentDealer,
                  productMap,
                }).map((line) => (
                  <div
                    key={line}
                    className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2"
                  >
                    <p className="text-sm leading-6 text-indigo-950">{line}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </ReasonDrawer>
    </div>
  );
}

function ReasonDrawer(input: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
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
        aria-label="关闭推荐原因抽屉"
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
        <div className="h-[calc(100%-64px)] overflow-y-auto px-5 py-4">{input.children}</div>
      </aside>
    </div>,
    document.body,
  );
}
