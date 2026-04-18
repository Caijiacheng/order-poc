"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShoppingCart, X } from "lucide-react";

import { OrderSubmitCopilotPanel } from "@/components/frontstage/copilot/order-submit-copilot-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  addCartItem,
  fetchActiveDealers,
  fetchCart,
  formatMoney,
  optimizeCart,
  patchCartItem,
  removeCartItem,
  submitCart,
  type CopilotApplyDraftResponse,
  type CartOptimizationResponse,
} from "@/lib/frontstage/api";
import type {
  CartItem,
  CartOptimizationRecommendationBar,
  CartSession,
  DealerEntity,
} from "@/lib/memory/types";

function buildBarActionKey(bar: CartOptimizationRecommendationBar) {
  return `bar:${bar.bar_id}`;
}

export default function OrderSubmitPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
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
  const skipNextAutoOptimize = useRef(false);

  useEffect(() => {
    const bootstrap = async () => {
      setLoadingPage(true);
      try {
        const [dealerList, cartSession] = await Promise.all([
          fetchActiveDealers(),
          fetchCart(),
        ]);
        setDealers(dealerList);
        setCart(cartSession);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载购物车提交页失败");
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

  const recomputeOptimization = async (options?: { silent?: boolean }) => {
    if (!cart || cart.items.length === 0) {
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
      const result = await optimizeCart(cart.customer_id);
      if (latestOptimizationToken.current !== token) {
        return;
      }
      setOptimization(result);
      if (!options?.silent) {
        setSuccessMessage("顺手补货推荐已按最新购物车自动刷新。");
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
  };

  useEffect(() => {
    if (loadingPage || !cart) {
      return;
    }
    if (skipNextAutoOptimize.current) {
      skipNextAutoOptimize.current = false;
      return;
    }
    if (cart.items.length === 0) {
      setOptimization(null);
      return;
    }
    void recomputeOptimization({ silent: true });
  }, [cart, cartSignature, loadingPage]);

  const updateItemQty = async (skuId: string) => {
    const qtyValue = Number(qtyDraft[skuId] ?? "0");
    if (!Number.isFinite(qtyValue)) {
      return;
    }
    const qty = Math.floor(qtyValue);
    setBusyActionKey(`patch:${skuId}`);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await patchCartItem({ skuId, qty });
      setCart(result.cart);
      setSuccessMessage(qty <= 0 ? `已移除 ${skuId}` : `已更新 ${skuId} 数量`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新数量失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const handleRemoveItem = async (skuId: string) => {
    setBusyActionKey(`remove:${skuId}`);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await removeCartItem(skuId);
      setCart(result.cart);
      setSuccessMessage(`已删除 ${skuId}`);
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
      setQtyDraft({});
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

  const handleCopilotApplySuccess = (applied: CopilotApplyDraftResponse) => {
    latestOptimizationToken.current = Date.now();
    skipNextAutoOptimize.current = true;
    setCart(applied.cart);
    setOptimization(applied.optimization);
    setOptimizing(false);
    setOpenedBarId(null);
    setQtyDraft({});
    setSuccessMessage("Copilot 已应用预览补齐并同步结算推荐。");
    setErrorMessage("");
  };

  const recommendationBars = optimization?.recommendationBars ?? [];
  const openedBar = recommendationBars.find((bar) => bar.bar_id === openedBarId) ?? null;

  return (
    <div className="space-y-6" data-testid="order-submit-workbench">
      <section className="space-y-3">
        <Badge className="rounded-full px-3 py-1">购物车提交页</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          购物车结算与提交
        </h1>
        <p className="text-sm text-slate-600">
          系统会根据最新购物车自动给出顺手补货和凑单推荐，你只需逐条决定是否采纳，然后完成交易信息确认。
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
              支持改量、删项。商品变化后，右侧推荐条会自动刷新。
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
                购物车为空，请先返回采购工作台进行组货或加购。
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.items.map((row) => (
                    <TableRow key={row.sku_id}>
                      <TableCell className="font-mono text-xs">{row.sku_id}</TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-900">{row.sku_name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          来源：{row.source === "recommendation" ? "系统推荐" : "手工加购"}
                        </p>
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
                            aria-label={`${row.sku_name} 数量`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateItemQty(row.sku_id)}
                            disabled={busyActionKey === `patch:${row.sku_id}`}
                          >
                            更新
                          </Button>
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
              <p className="text-sm text-slate-600">
                推荐条会贴近金额和提交区展示，帮助你顺手补齐更合适的组合。
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">当前经销商</p>
                <p className="mt-1 font-medium text-slate-900">
                  {currentDealer?.customer_name ?? "未选择经销商"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">商品金额 / 门槛</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {formatMoney(cart?.summary.total_amount ?? 0)} /{" "}
                  {formatMoney(cart?.summary.threshold_amount ?? 0)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {cart?.summary.threshold_reached
                    ? "已达到当前门槛，可直接完成交易确认。"
                    : `距门槛还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/purchase">返回继续选品</Link>
                </Button>
                <Button
                  id="order-submit-primary-button"
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
              <CardTitle className="text-xl text-slate-900">顺手补货推荐</CardTitle>
              <p className="text-sm text-slate-600">
                推荐条围绕活动门槛、箱规和搭配补充组织，不再采用独立优化面板。
              </p>
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
                          <p className="mt-1 text-sm text-slate-700">{bar.value_message}</p>
                        </div>
                        <Badge variant="outline">
                          {bar.bar_type === "threshold"
                            ? "活动门槛"
                            : bar.bar_type === "box_adjustment"
                              ? "箱规修正"
                              : "搭配补充"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {bar.items.length === 1 && firstItem
                          ? `${firstItem.sku_name} · ${firstItem.action_type === "adjust_qty" ? `调整到 ${firstItem.to_qty ?? firstItem.suggested_qty} 箱` : `建议 ${firstItem.suggested_qty} 箱`}`
                          : `涉及 ${bar.items.length} 个 SKU 组合`}
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
                          为什么推荐
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
                这部分承接真实 B2B 提交动作：收货、配送、结算、发票与备注。
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
              <p className="text-sm font-medium text-slate-900">{openedBar.value_message}</p>
              <p className="mt-1 text-xs text-slate-600">组合 ID：{openedBar.combo_id}</p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">SKU 明细</p>
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
                    <p className="mt-1 font-mono text-xs text-slate-500">{item.sku_id}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">业务解释</p>
              <p className="mt-2 text-sm leading-6 text-indigo-900">{openedBar.explanation}</p>
            </section>
          </div>
        ) : null}
      </ReasonDrawer>

      <OrderSubmitCopilotPanel
        customerId={cart?.customer_id ?? ""}
        customerName={currentDealer?.customer_name}
        cart={cart}
        optimization={optimization}
        onApplySuccess={handleCopilotApplySuccess}
      />
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
