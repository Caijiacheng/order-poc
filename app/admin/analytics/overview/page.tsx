"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Filter, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { CopilotDraft, CopilotJob, CopilotMetricsStore, CopilotRun } from "@/lib/copilot/types";
import type {
  DealerEntity,
  RecommendationBatchRecord,
  RecommendationRunRecord,
  RecommendationStrategyEntity,
} from "@/lib/memory/types";

type QueryState = {
  dateFrom: string;
  dateTo: string;
  customerId: string;
};

type AnalyticsData = {
  batches: RecommendationBatchRecord[];
  records: RecommendationRunRecord[];
  dealers: DealerEntity[];
  strategies: RecommendationStrategyEntity[];
};

type CopilotOverviewData = {
  metrics: CopilotMetricsStore;
  total: number;
  rows: Array<{
    run: CopilotRun;
    job: CopilotJob | null;
    draft: CopilotDraft | null;
  }>;
};

const SCENE_LABELS: Record<string, string> = {
  hot_sale_restock: "热销补货",
  stockout_restock: "缺货补货",
  campaign_stockup: "活动备货",
  checkout_optimization: "结算页凑单",
  daily_recommendation: "日常补货(兼容)",
  weekly_focus: "周活动备货(兼容)",
  threshold_topup: "门槛补差(兼容)",
  box_pair_optimization: "箱规与搭配优化(兼容)",
};

const EMPTY_DATA: AnalyticsData = {
  batches: [],
  records: [],
  dealers: [],
  strategies: [],
};

const EMPTY_COPILOT_DATA: CopilotOverviewData = {
  metrics: {
    copilot_usage_count: 0,
    copilot_autofill_start_count: 0,
    copilot_preview_success_rate: 0,
    copilot_apply_to_cart_success_rate: 0,
    copilot_campaign_topup_success_rate: 0,
    copilot_checkout_conversion_rate: 0,
    copilot_avg_latency_ms: 0,
  },
  total: 0,
  rows: [],
};

function getDefaultRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    dateFrom: start.toISOString().slice(0, 16),
    dateTo: end.toISOString().slice(0, 16),
  };
}

function toIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function AnalyticsOverviewPage() {
  const defaultRange = getDefaultRange();
  const [query, setQuery] = useState<QueryState>({
    dateFrom: defaultRange.dateFrom,
    dateTo: defaultRange.dateTo,
    customerId: "",
  });
  const [data, setData] = useState<AnalyticsData>(EMPTY_DATA);
  const [copilotData, setCopilotData] = useState<CopilotOverviewData>(EMPTY_COPILOT_DATA);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const batchParams = new URLSearchParams({
        page: "1",
        pageSize: "500",
        sortBy: "created_at",
        sortOrder: "desc",
      });
      const recordParams = new URLSearchParams({
        page: "1",
        pageSize: "500",
        sortBy: "created_at",
        sortOrder: "desc",
      });
      const dateFromIso = toIso(nextQuery.dateFrom);
      const dateToIso = toIso(nextQuery.dateTo);
      if (dateFromIso) {
        batchParams.set("dateFrom", dateFromIso);
        recordParams.set("dateFrom", dateFromIso);
      }
      if (dateToIso) {
        batchParams.set("dateTo", dateToIso);
        recordParams.set("dateTo", dateToIso);
      }
      if (nextQuery.customerId.trim()) {
        batchParams.set("customerId", nextQuery.customerId.trim());
        recordParams.set("customerId", nextQuery.customerId.trim());
      }

      const [batchData, recordData, dealerData, strategyData, copilotOverview] =
        await Promise.all([
        requestJson<ListResult<RecommendationBatchRecord>>(
          `/api/admin/recommendation-batches?${batchParams.toString()}`,
        ),
        requestJson<ListResult<RecommendationRunRecord>>(
          `/api/admin/recommendation-records?${recordParams.toString()}`,
        ),
        requestJson<ListResult<DealerEntity>>(
          "/api/admin/dealers?page=1&pageSize=500&sortBy=customer_name&sortOrder=asc",
        ),
        requestJson<ListResult<RecommendationStrategyEntity>>(
          "/api/admin/recommendation-strategies?sceneGroup=purchase&page=1&pageSize=500&sortBy=priority&sortOrder=asc",
        ),
        requestJson<CopilotOverviewData>(
          `/api/admin/copilot/overview?${new URLSearchParams({
            limit: "80",
            dateFrom: dateFromIso,
            dateTo: dateToIso,
            customerId: nextQuery.customerId.trim(),
          }).toString()}`,
        ),
      ]);

      setData({
        batches: batchData.items,
        records: recordData.items,
        dealers: dealerData.items,
        strategies: strategyData.items,
      });
      setCopilotData(copilotOverview);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载结果总览失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchaseBatches = data.batches;
  const purchaseRecords = data.records.filter(
    (item) => item.surface === "purchase" && item.generation_mode === "precomputed",
  );
  const checkoutRealtimeRecords = data.records.filter(
    (item) => item.surface === "checkout" && item.generation_mode === "realtime",
  );

  const publishedBatches = purchaseBatches.filter(
    (item) => item.publication_status === "published",
  ).length;

  const adoptedRuns = purchaseRecords.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const adoptionRate =
    purchaseRecords.length === 0 ? 0 : (adoptedRuns / purchaseRecords.length) * 100;
  const purchaseAvgLatency =
    purchaseRecords.length === 0
      ? 0
      : Math.round(
          purchaseRecords.reduce((sum, item) => sum + item.model_latency_ms, 0) /
            purchaseRecords.length,
        );
  const checkoutAvgLatency =
    checkoutRealtimeRecords.length === 0
      ? 0
      : Math.round(
          checkoutRealtimeRecords.reduce((sum, item) => sum + item.model_latency_ms, 0) /
            checkoutRealtimeRecords.length,
        );

  const sceneBreakdown = Object.entries(
    purchaseRecords.reduce<Record<string, number>>((acc, run) => {
      acc[run.scene] = (acc[run.scene] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const strategyNameMap = new Map(
    data.strategies.map((item) => [item.strategy_id, item.strategy_name] as const),
  );
  const strategyContribution = Object.entries(
    purchaseRecords.reduce<Record<string, number>>((acc, run) => {
      const key = run.strategy_id || "default_strategy";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const checkoutAdoptedRuns = checkoutRealtimeRecords.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const checkoutAdoptionRate =
    checkoutRealtimeRecords.length === 0
      ? 0
      : (checkoutAdoptedRuns / checkoutRealtimeRecords.length) * 100;

  return (
    <AdminPageFrame
      title="结果总览"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/analytics/recommendation-records?view=purchase" className="gap-2">
              查看门店建议
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label>开始时间</Label>
            <Input
              type="datetime-local"
              value={query.dateFrom}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateFrom: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>结束时间</Label>
            <Input
              type="datetime-local"
              value={query.dateTo}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateTo: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>经销商（可选）</Label>
            <Select
              value={query.customerId || "__all__"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  customerId: value === "__all__" ? "" : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="全部经销商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部经销商</SelectItem>
                {data.dealers.map((dealer) => (
                  <SelectItem key={dealer.customer_id} value={dealer.customer_id}>
                    {dealer.customer_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" variant="outline" onClick={() => void loadData(query)}>
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">采购预处理批次</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{purchaseBatches.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">已发布采购批次</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{publishedBatches}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">采购建议记录</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{purchaseRecords.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">结算凑单记录</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{checkoutRealtimeRecords.length}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Copilot 核心指标（最小集）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">Copilot 使用次数</p>
              <p className="kpi-value mt-1 text-xl">{copilotData.metrics.copilot_usage_count}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">一键做单发起数</p>
              <p className="kpi-value mt-1 text-xl">
                {copilotData.metrics.copilot_autofill_start_count}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">预览成功率</p>
              <p className="kpi-value mt-1 text-xl">
                {formatRate(copilotData.metrics.copilot_preview_success_rate)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">应用成功率</p>
              <p className="kpi-value mt-1 text-xl">
                {formatRate(copilotData.metrics.copilot_apply_to_cart_success_rate)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">活动补齐成功率</p>
              <p className="kpi-value mt-1 text-xl">
                {formatRate(copilotData.metrics.copilot_campaign_topup_success_rate)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">辅助结算转化率</p>
              <p className="kpi-value mt-1 text-xl">
                {formatRate(copilotData.metrics.copilot_checkout_conversion_rate)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">平均耗时</p>
              <p className="kpi-value mt-1 text-xl">
                {copilotData.metrics.copilot_avg_latency_ms}ms
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-500">Copilot 运行数</p>
              <p className="kpi-value mt-1 text-xl">{copilotData.total}</p>
            </div>
          </section>
          <p className="text-xs text-slate-500">
            指标来自内存态 Copilot 事件汇总，用于当前 POC 运行监控与演示复盘。
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">采购建议</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采购建议记录</p>
                <p className="kpi-value text-xl">{purchaseRecords.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采购已采纳记录</p>
                <p className="kpi-value text-xl">{adoptedRuns}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采购采纳率</p>
                <p className="kpi-value text-xl">{adoptionRate.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采购平均模型耗时</p>
                <p className="kpi-value text-xl">{purchaseAvgLatency}ms</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/analytics/recommendation-records?view=purchase">
                查看采购建议记录
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">结算凑单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">实时记录规模</p>
              <div className="flex items-center justify-between">
                <span>实时 run 数</span>
                <span className="kpi-value">{checkoutRealtimeRecords.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>平均模型耗时</span>
                <span className="kpi-value">{checkoutAvgLatency}ms</span>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">结算凑单采纳情况</p>
              <p className="text-sm text-slate-600">
                当前共触发 {checkoutRealtimeRecords.length} 次凑单推荐，采纳率 {checkoutAdoptionRate.toFixed(1)}%。
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/analytics/recommendation-records?view=checkout">
                  查看结算凑单记录
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">采购场景分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            {sceneBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500">暂无采购场景数据</p>
            ) : (
              sceneBreakdown.map(([scene, count]) => (
                <div key={scene} className="flex items-center justify-between">
                  <span>{SCENE_LABELS[scene] ?? scene}</span>
                  <span className="kpi-value">{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">采购方案贡献（按建议数）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            {strategyContribution.length === 0 ? (
              <p className="text-sm text-slate-500">暂无策略贡献数据</p>
            ) : (
              strategyContribution.map(([strategyId, count]) => (
                <div key={strategyId} className="flex items-center justify-between">
                  <span>{strategyNameMap.get(strategyId) ?? "默认方案"}</span>
                  <span className="kpi-value">{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
