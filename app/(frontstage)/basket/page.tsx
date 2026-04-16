"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addCartItem,
  fetchActiveDealers,
  fetchCart,
  formatMoney,
  optimizeCart,
  patchCartItem,
  removeCartItem,
  type CartOptimizationResponse,
} from "@/lib/frontstage/api";
import type { CartSession, DealerEntity } from "@/lib/memory/types";

export default function BasketPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [dealerId, setDealerId] = useState("");
  const [cart, setCart] = useState<CartSession | null>(null);
  const [optimization, setOptimization] = useState<CartOptimizationResponse | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [loadingPage, setLoadingPage] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [busyApplyAll, setBusyApplyAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const bootstrap = async () => {
      setLoadingPage(true);
      try {
        const [dealerList, currentCart] = await Promise.all([fetchActiveDealers(), fetchCart()]);
        setDealers(dealerList);
        setCart(currentCart);
        setDealerId(currentCart.customer_id || dealerList[0]?.customer_id || "");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载采购清单失败");
      } finally {
        setLoadingPage(false);
      }
    };

    void bootstrap();
  }, []);

  const reloadCart = async () => {
    const nextCart = await fetchCart();
    setCart(nextCart);
    return nextCart;
  };

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

  const runOptimization = async () => {
    setOptimizing(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await optimizeCart(dealerId || cart?.customer_id);
      setOptimization(result);
      setSuccessMessage("已生成订单优化建议。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "生成优化建议失败");
    } finally {
      setOptimizing(false);
    }
  };

  const applyThresholdSuggestion = async () => {
    if (!optimization?.thresholdSuggestion) {
      return;
    }
    const suggestion = optimization.thresholdSuggestion;
    setBusyActionKey(`apply:threshold:${suggestion.sku_id}`);
    setErrorMessage("");
    try {
      const result = await addCartItem({
        customerId: dealerId || cart?.customer_id,
        source: "recommendation",
        recommendation_item_id: suggestion.recommendation_item_id,
        sku_id: suggestion.sku_id,
        qty: suggestion.suggested_qty,
      });
      setCart(result.cart);
      setSuccessMessage(`已应用金额优化建议：${suggestion.sku_id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "应用金额优化建议失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const applyBoxAdjustment = async (skuId: string, toQty: number, recommendationItemId?: string) => {
    setBusyActionKey(`apply:box:${skuId}`);
    setErrorMessage("");
    try {
      const result = await patchCartItem({
        skuId,
        qty: toQty,
        recommendation_item_id: recommendationItemId,
      });
      setCart(result.cart);
      setSuccessMessage(`已按箱规修正 ${skuId} 至 ${toQty}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "应用箱规修正失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const applyPairSuggestion = async (skuId: string, qty: number, recommendationItemId?: string) => {
    setBusyActionKey(`apply:pair:${skuId}`);
    setErrorMessage("");
    try {
      const result = await addCartItem({
        customerId: dealerId || cart?.customer_id,
        source: "recommendation",
        recommendation_item_id: recommendationItemId,
        sku_id: skuId,
        qty,
      });
      setCart(result.cart);
      setSuccessMessage(`已补充搭配商品：${skuId}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "应用搭配建议失败");
    } finally {
      setBusyActionKey("");
    }
  };

  const applyAllOptimizations = async () => {
    if (!optimization) {
      return;
    }

    setBusyApplyAll(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      if (optimization.thresholdSuggestion) {
        await addCartItem({
          customerId: dealerId || cart?.customer_id,
          source: "recommendation",
          recommendation_item_id: optimization.thresholdSuggestion.recommendation_item_id,
          sku_id: optimization.thresholdSuggestion.sku_id,
          qty: optimization.thresholdSuggestion.suggested_qty,
        });
      }
      for (const item of optimization.boxAdjustments) {
        await patchCartItem({
          skuId: item.sku_id,
          qty: item.to_qty,
          recommendation_item_id: item.recommendation_item_id,
        });
      }
      for (const item of optimization.pairSuggestions) {
        await addCartItem({
          customerId: dealerId || cart?.customer_id,
          source: "recommendation",
          recommendation_item_id: item.recommendation_item_id,
          sku_id: item.sku_id,
          qty: item.suggested_qty,
        });
      }
      await reloadCart();
      setSuccessMessage("已批量应用本次订单优化建议。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批量应用失败");
    } finally {
      setBusyApplyAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Badge className="rounded-full px-3 py-1">采购清单</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">订单校正与优化</h1>
        <p className="text-sm text-slate-600">
          在提交前统一调整数量与结构，按金额、箱规、搭配三个维度完成清单优化。
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
            <CardTitle className="text-xl text-slate-900">采购清单明细</CardTitle>
            <p className="text-sm text-slate-600">支持改量、删项与即时金额回算。</p>
          </CardHeader>
          <CardContent>
            {loadingPage || !cart ? (
              <div className="py-10 text-center text-sm text-slate-500">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                正在加载采购清单...
              </div>
            ) : cart.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                采购清单为空，请先去采购首页或商品选购加购商品。
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
                        <p className="text-sm text-slate-900">{row.sku_name}</p>
                        <p className="text-xs text-slate-500">
                          来源：{row.source === "recommendation" ? "系统建议" : "手工加购"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(row.price_per_case)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-20 text-right"
                            value={qtyDraft[row.sku_id] ?? String(row.qty)}
                            onChange={(event) =>
                              setQtyDraft((prev) => ({ ...prev, [row.sku_id]: event.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateItemQty(row.sku_id)}
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
                          onClick={() => handleRemoveItem(row.sku_id)}
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

        <Card
          className="h-fit border-slate-200 bg-gradient-to-b from-slate-50 to-white lg:sticky lg:top-24"
          data-testid="basket-summary"
        >
          <CardHeader>
            <CardTitle className="text-xl text-slate-900">订单摘要</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Demo Mode · 经销商切换
              </p>
              <Select value={dealerId} onValueChange={setDealerId} disabled={loadingPage}>
                <SelectTrigger className="mt-2 h-9 w-full rounded-xl bg-white">
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
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-slate-500">SKU / 件数</p>
              <p className="kpi-value mt-1 text-lg text-slate-900">
                {cart?.summary.sku_count ?? 0} / {cart?.summary.item_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-slate-500">订单金额 / 门槛</p>
              <p className="kpi-value mt-1 text-lg text-slate-900">
                {formatMoney(cart?.summary.total_amount ?? 0)} /{" "}
                {formatMoney(cart?.summary.threshold_amount ?? 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {cart?.summary.threshold_reached
                  ? "已达到门槛，可直接去下单确认"
                  : `距门槛还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={runOptimization} disabled={optimizing}>
                {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                生成优化建议
              </Button>
              <Button onClick={applyAllOptimizations} disabled={!optimization || busyApplyAll}>
                {busyApplyAll ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                一键应用全部
              </Button>
              <Button asChild variant="outline">
                <Link href="/checkout">去下单确认</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" data-testid="basket-optimization-panel">
        <Card className="border-slate-200 bg-white/92">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">金额优化</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!optimization?.thresholdSuggestion ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                {optimization
                  ? "当前清单已满足门槛，无需补齐。"
                  : "生成优化建议后可查看门槛补齐方案。"}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">{optimization.thresholdSuggestion.reason}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {optimization.thresholdSuggestion.sku_id} · 建议{" "}
                  {optimization.thresholdSuggestion.suggested_qty} 箱
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={applyThresholdSuggestion}
                  disabled={
                    busyActionKey ===
                    `apply:threshold:${optimization.thresholdSuggestion.sku_id}`
                  }
                >
                  应用金额优化
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/92">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">箱规修正</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!optimization ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                生成优化建议后可查看箱规修正项。
              </div>
            ) : optimization.boxAdjustments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                当前无箱规修正建议。
              </div>
            ) : (
              optimization.boxAdjustments.map((item) => (
                <div key={item.sku_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-700">{item.reason}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {item.sku_id}：{item.from_qty} → {item.to_qty}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() =>
                      applyBoxAdjustment(item.sku_id, item.to_qty, item.recommendation_item_id)
                    }
                    disabled={busyActionKey === `apply:box:${item.sku_id}`}
                  >
                    应用修正
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/92">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">搭配补充</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!optimization ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                生成优化建议后可查看搭配补充项。
              </div>
            ) : optimization.pairSuggestions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                当前无搭配补充建议。
              </div>
            ) : (
              optimization.pairSuggestions.map((item) => (
                <div key={item.sku_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-700">{item.reason}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {item.sku_id} · 建议 {item.suggested_qty} 箱
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() =>
                      applyPairSuggestion(
                        item.sku_id,
                        item.suggested_qty,
                        item.recommendation_item_id,
                      )
                    }
                    disabled={busyActionKey === `apply:pair:${item.sku_id}`}
                  >
                    应用补充
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
