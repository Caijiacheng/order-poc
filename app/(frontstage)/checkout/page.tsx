"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchActiveDealers,
  fetchCart,
  fetchRecommendationRunDetail,
  fetchRecommendationRuns,
  formatMoney,
  submitCart,
} from "@/lib/frontstage/api";
import type { CartItem, CartSession, DealerEntity } from "@/lib/memory/types";

export default function CheckoutPage() {
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [reasonByRecommendationItemId, setReasonByRecommendationItemId] = useState<
    Record<string, string>
  >({});
  const [reasonBySkuId, setReasonBySkuId] = useState<Record<string, string>>({});
  const [reasonLoading, setReasonLoading] = useState(false);
  const [openedReasonKey, setOpenedReasonKey] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<{
    order_id: string;
    submitted_at: string;
    total_amount: number;
    item_count: number;
  } | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        const [dealerList, cartSession] = await Promise.all([
          fetchActiveDealers(),
          fetchCart(),
        ]);
        setDealers(dealerList);
        setCart(cartSession);
        if (cartSession.customer_id) {
          await loadAdoptedReasons(cartSession.customer_id);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "加载下单确认页失败");
      } finally {
        setLoading(false);
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

  const recommendationLines = (cart?.items ?? []).filter(
    (item) => item.source === "recommendation",
  );

  const loadAdoptedReasons = async (customerId: string) => {
    setReasonLoading(true);
    try {
      const query = new URLSearchParams({
        page: "1",
        pageSize: "20",
        sortBy: "created_at",
        sortOrder: "desc",
      });
      query.set("customerId", customerId);
      const runs = await fetchRecommendationRuns(query);
      const detailList = await Promise.all(
        runs.list.items.map((run) =>
          fetchRecommendationRunDetail(run.recommendation_run_id).catch(() => null),
        ),
      );

      const nextReasonByItemId: Record<string, string> = {};
      const nextReasonBySkuId: Record<string, string> = {};

      for (const detail of detailList) {
        if (!detail) {
          continue;
        }
        for (const item of detail.items) {
          if (!item.was_applied) {
            continue;
          }
          if (item.reason && !nextReasonByItemId[item.recommendation_item_id]) {
            nextReasonByItemId[item.recommendation_item_id] = item.reason;
          }
          if (item.reason && !nextReasonBySkuId[item.sku_id]) {
            nextReasonBySkuId[item.sku_id] = item.reason;
          }
        }
      }

      setReasonByRecommendationItemId(nextReasonByItemId);
      setReasonBySkuId(nextReasonBySkuId);
    } catch {
      setReasonByRecommendationItemId({});
      setReasonBySkuId({});
    } finally {
      setReasonLoading(false);
    }
  };

  const getReasonText = (item: CartItem) => {
    if (item.recommendation_item_id) {
      const byId = reasonByRecommendationItemId[item.recommendation_item_id];
      if (byId) {
        return byId;
      }
    }
    return reasonBySkuId[item.sku_id] ?? "";
  };

  const fallbackReasonText =
    "该优化建议来源于系统历史推荐，当前未检索到详细原因，请在下一次推荐时查看实时说明。";

  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await submitCart();
      setSubmittedOrder(result.order);
      setCart(result.cart);
      setSuccessMessage("订单提交成功。");
      if (result.cart.customer_id) {
        await loadAdoptedReasons(result.cart.customer_id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交订单失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Badge className="rounded-full px-3 py-1">下单确认</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">交易确认页</h1>
        <p className="text-sm text-slate-600">
          确认订单明细、配送与结算信息后提交订单；本单优化说明由系统自动汇总。
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

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Card className="border-slate-200 bg-white/92">
            <CardHeader>
              <CardTitle className="text-xl text-slate-900">订单明细</CardTitle>
            </CardHeader>
            <CardContent>
              {loading || !cart ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  正在加载订单明细...
                </div>
              ) : cart.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  当前采购清单为空，请先返回采购清单补货。
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>商品</TableHead>
                      <TableHead className="text-right">单价</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                      <TableHead className="text-right">小计</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.items.map((item) => (
                      <TableRow key={item.sku_id}>
                        <TableCell>
                          <p className="text-sm text-slate-900">{item.sku_name}</p>
                          <p className="font-mono text-xs text-slate-500">{item.sku_id}</p>
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(item.price_per_case)}</TableCell>
                        <TableCell className="text-right">{item.qty}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(item.price_per_case * item.qty)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-lg text-slate-900">收货信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>收货客户：{currentDealer?.customer_name ?? "未选择经销商"}</p>
                <p>收货城市：{currentDealer?.city ?? "-"}</p>
                <p>收货地址：{currentDealer?.city ? `${currentDealer.city}主仓演示地址` : "-"}</p>
                <p>收货联系人：采购负责人（POC）</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-lg text-slate-900">配送信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>配送方式：仓配一体（POC）</p>
                <p>预计送达：次日达（工作日）</p>
                <p>卸货要求：整箱交付，按 SKU 码放</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-lg text-slate-900">结算方式 / 账期</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>结算方式：月结</p>
                <p>账期：30 天</p>
                <p>对账周期：每周五</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-lg text-slate-900">发票信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>发票类型：增值税专用发票</p>
                <p>开票抬头：{currentDealer?.customer_name ?? "待确认"}</p>
                <p>寄送方式：随货同行（POC）</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 bg-white/92">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900">订单备注</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={orderNote}
                onChange={(event) => setOrderNote(event.target.value)}
                placeholder="可填写送货窗口、收货人要求、到货提醒等备注（POC 展示字段）"
                rows={4}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card
            className="border-slate-200 bg-gradient-to-b from-slate-50 to-white"
            data-testid="checkout-summary"
          >
            <CardHeader>
              <CardTitle className="text-xl text-slate-900">金额汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">SKU / 件数</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {cart?.summary.sku_count ?? 0} / {cart?.summary.item_count ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">订单金额</p>
                <p className="kpi-value mt-1 text-lg text-slate-900">
                  {formatMoney(cart?.summary.total_amount ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-slate-500">门槛状态</p>
                <p className="mt-1 text-slate-700">
                  {cart?.summary.threshold_reached
                    ? "已达到门槛"
                    : `距门槛还差 ${formatMoney(cart?.summary.gap_to_threshold ?? 0)}`}
                </p>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSubmitOrder}
                  disabled={submitting || !cart || cart.items.length === 0}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  确认提交订单
                </Button>
                <Button asChild variant="outline">
                  <Link href="/basket">返回采购清单</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/92">
            <CardHeader>
              <CardTitle className="text-xl text-slate-900">本单优化说明</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {recommendationLines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-3 text-slate-500">
                  本单未采纳额外优化建议。
                </div>
              ) : (
                recommendationLines.map((item) => (
                  <div
                    key={item.recommendation_item_id || item.sku_id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-slate-800">
                      已采纳优化建议：{item.sku_name} × {item.qty}
                    </p>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reasonLoading}
                        onClick={() => {
                          const key = item.recommendation_item_id || item.sku_id;
                          setOpenedReasonKey((prev) => (prev === key ? null : key));
                        }}
                      >
                        {reasonLoading
                          ? "原因加载中"
                          : openedReasonKey === (item.recommendation_item_id || item.sku_id)
                            ? "收起原因"
                            : "查看原因"}
                      </Button>
                    </div>
                    {openedReasonKey === (item.recommendation_item_id || item.sku_id) ? (
                      <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                        <p>{getReasonText(item) || fallbackReasonText}</p>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {submittedOrder ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="space-y-1 p-4 text-sm text-emerald-900">
                <p className="font-medium">最近提交成功</p>
                <p className="font-mono text-xs">{submittedOrder.order_id}</p>
                <p>
                  {new Date(submittedOrder.submitted_at).toLocaleString("zh-CN")} ·{" "}
                  {formatMoney(submittedOrder.total_amount)} · {submittedOrder.item_count} 件
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
