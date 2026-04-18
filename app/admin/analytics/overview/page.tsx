"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Filter, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { RecommendationBatchRecord, RecommendationRunRecord } from "@/lib/memory/types";

type QueryState = {
  dateFrom: string;
  dateTo: string;
  customerId: string;
};

type AnalyticsData = {
  batches: RecommendationBatchRecord[];
  records: RecommendationRunRecord[];
};

const SCENE_LABELS: Record<string, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  threshold_topup: "门槛补差",
  box_pair_optimization: "箱规与搭配优化",
};

const EMPTY_DATA: AnalyticsData = {
  batches: [],
  records: [],
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

export default function AnalyticsOverviewPage() {
  const defaultRange = getDefaultRange();
  const [query, setQuery] = useState<QueryState>({
    dateFrom: defaultRange.dateFrom,
    dateTo: defaultRange.dateTo,
    customerId: "",
  });
  const [data, setData] = useState<AnalyticsData>(EMPTY_DATA);
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

      const [batchData, recordData] = await Promise.all([
        requestJson<ListResult<RecommendationBatchRecord>>(
          `/api/admin/recommendation-batches?${batchParams.toString()}`,
        ),
        requestJson<ListResult<RecommendationRunRecord>>(
          `/api/admin/recommendation-records?${recordParams.toString()}`,
        ),
      ]);

      setData({
        batches: batchData.items,
        records: recordData.items,
      });
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

  const successBatches = data.batches.filter((item) => item.status === "success").length;
  const failedBatches = data.batches.filter((item) =>
    ["failed", "partial_failed", "fallback_served"].includes(item.status),
  ).length;
  const publishedBatches = data.batches.filter(
    (item) => item.publication_status === "published",
  ).length;

  const adoptedRuns = data.records.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const adoptionRate =
    data.records.length === 0 ? 0 : (adoptedRuns / data.records.length) * 100;
  const avgLatency =
    data.records.length === 0
      ? 0
      : Math.round(
          data.records.reduce((sum, item) => sum + item.model_latency_ms, 0) /
            data.records.length,
        );

  const sceneBreakdown = Object.entries(
    data.records.reduce<Record<string, number>>((acc, run) => {
      acc[run.scene] = (acc[run.scene] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const strategyContribution = Object.entries(
    data.records.reduce<Record<string, number>>((acc, run) => {
      const key = run.strategy_id || "未绑定策略";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const abnormalBatches = data.batches.filter((item) =>
    ["failed", "partial_failed", "fallback_served"].includes(item.status),
  );

  return (
    <AdminPageFrame
      title="结果总览"
      description="按时间查看生成结果、发布情况和门店采纳效果。"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/analytics/recommendation-records" className="gap-2">
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
            <Input
              value={query.customerId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, customerId: event.target.value }))
              }
              placeholder="customer_xxx"
            />
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
            <CardTitle className="text-sm text-slate-600">批次总数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{data.batches.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">成功批次</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{successBatches}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">异常批次</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{failedBatches}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">已发布批次</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{publishedBatches}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日运营情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">门店建议数</p>
                <p className="kpi-value text-xl">{data.records.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">已采纳记录</p>
                <p className="kpi-value text-xl">{adoptedRuns}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采纳率</p>
                <p className="kpi-value text-xl">{adoptionRate.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">平均模型耗时</p>
                <p className="kpi-value text-xl">{avgLatency}ms</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">门店建议 {data.records.length}</Badge>
              <Badge variant="outline">批次异常 {abnormalBatches.length}</Badge>
              <Badge variant="outline">已发布批次 {publishedBatches}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              这一块用于先看当前筛选时间范围内的发布、异常、采纳和模型耗时，再决定是否继续下钻到具体建议。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">场景分布和方案贡献</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">场景分布</p>
              {sceneBreakdown.length === 0 ? (
                <p className="text-sm text-slate-500">暂无场景数据</p>
              ) : (
                sceneBreakdown.map(([scene, count]) => (
                  <div key={scene} className="flex items-center justify-between">
                    <span>{SCENE_LABELS[scene] ?? scene}</span>
                    <span className="kpi-value">{count}</span>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">方案贡献（按建议数）</p>
              {strategyContribution.length === 0 ? (
                <p className="text-sm text-slate-500">暂无策略贡献数据</p>
              ) : (
                strategyContribution.map(([strategyId, count]) => (
                  <div key={strategyId} className="flex items-center justify-between">
                    <span className="font-mono text-xs">{strategyId}</span>
                    <span className="kpi-value">{count}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">异常批次清单</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>批次 ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>任务 / 经销商</TableHead>
                <TableHead>错误摘要</TableHead>
                <TableHead className="text-right">下钻</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {abnormalBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    当前筛选范围内无异常批次
                  </TableCell>
                </TableRow>
              ) : (
                abnormalBatches.slice(0, 12).map((batch) => (
                  <TableRow key={batch.batch_id}>
                    <TableCell className="font-mono text-xs">{batch.batch_id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{batch.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {batch.job_id ?? "-"} / {batch.customer_id ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate text-xs">
                      {batch.error_summary || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/admin/analytics/recommendation-records?batchId=${encodeURIComponent(
                              batch.batch_id,
                            )}`}
                          >
                            记录
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/admin/observability/traces?batchId=${encodeURIComponent(
                              batch.batch_id,
                            )}`}
                          >
                            链路
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPageFrame>
  );
}
