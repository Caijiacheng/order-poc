"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type {
  AuditLogEvent,
  CampaignEntity,
  ExpressionTemplateEntity,
  ProductEntity,
  RecommendationBatchRecord,
  RecommendationRunRecord,
  RecommendationStrategyEntity,
  DealerEntity,
} from "@/lib/memory/types";

type ConfigHealthItem = {
  label: string;
  total: number;
  active: number;
};

type WorkbenchData = {
  todayBatches: RecommendationBatchRecord[];
  todayRecords: RecommendationRunRecord[];
  recentLogs: AuditLogEvent[];
  configHealth: ConfigHealthItem[];
};

const EMPTY_DATA: WorkbenchData = {
  todayBatches: [],
  todayRecords: [],
  recentLogs: [],
  configHealth: [],
};

function getTodayIsoRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function toPercent(value: number) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

async function fetchHealthItem<T>(
  label: string,
  endpoint: string,
): Promise<ConfigHealthItem> {
  const [totalData, activeData] = await Promise.all([
    requestJson<ListResult<T>>(
      `${endpoint}&page=1&pageSize=1&sortBy=updated_at&sortOrder=desc`,
    ),
    requestJson<ListResult<T>>(
      `${endpoint}&page=1&pageSize=1&status=active&sortBy=updated_at&sortOrder=desc`,
    ),
  ]);
  return {
    label,
    total: totalData.total,
    active: activeData.total,
  };
}

export default function WorkbenchOverviewPage() {
  const [data, setData] = useState<WorkbenchData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const { startIso, endIso } = getTodayIsoRange();
      const batchParams = new URLSearchParams({
        page: "1",
        pageSize: "500",
        sortBy: "created_at",
        sortOrder: "desc",
        dateFrom: startIso,
        dateTo: endIso,
      });
      const recordParams = new URLSearchParams({
        page: "1",
        pageSize: "500",
        sortBy: "created_at",
        sortOrder: "desc",
        dateFrom: startIso,
        dateTo: endIso,
      });

      const [
        batchData,
        recordData,
        logData,
        productsHealth,
        dealersHealth,
        strategyHealth,
        campaignHealth,
        expressionHealth,
      ] = await Promise.all([
        requestJson<ListResult<RecommendationBatchRecord>>(
          `/api/admin/recommendation-batches?${batchParams.toString()}`,
        ),
        requestJson<ListResult<RecommendationRunRecord>>(
          `/api/admin/recommendation-records?${recordParams.toString()}`,
        ),
        requestJson<ListResult<AuditLogEvent>>(
          "/api/admin/audit-logs?page=1&pageSize=6&sortBy=timestamp&sortOrder=desc",
        ),
        fetchHealthItem<ProductEntity>("商品档案", "/api/admin/products?"),
        fetchHealthItem<DealerEntity>("经销商档案", "/api/admin/dealers?"),
        fetchHealthItem<RecommendationStrategyEntity>(
          "推荐策略",
          "/api/admin/recommendation-strategies?",
        ),
        fetchHealthItem<CampaignEntity>("活动策略", "/api/admin/campaigns?"),
        fetchHealthItem<ExpressionTemplateEntity>(
          "表达模板",
          "/api/admin/expression-templates?",
        ),
      ]);

      setData({
        todayBatches: batchData.items,
        todayRecords: recordData.items,
        recentLogs: logData.items,
        configHealth: [
          productsHealth,
          dealersHealth,
          strategyHealth,
          campaignHealth,
          expressionHealth,
        ],
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载工作台失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const batchSuccessCount = data.todayBatches.filter((item) => item.status === "success").length;
  const batchPartialCount = data.todayBatches.filter(
    (item) => item.status === "partial_failed",
  ).length;
  const batchFailureCount = data.todayBatches.filter(
    (item) => item.status === "failed" || item.status === "fallback_served",
  ).length;
  const abnormalBatches = data.todayBatches.filter((item) =>
    ["partial_failed", "failed", "fallback_served"].includes(item.status),
  );
  const todayPublished = data.todayBatches.filter(
    (item) => item.publication_status === "published",
  );

  const adoptedCount = data.todayRecords.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const adoptionRate =
    data.todayRecords.length === 0
      ? 0
      : (adoptedCount / data.todayRecords.length) * 100;
  const avgLatency =
    data.todayRecords.length === 0
      ? 0
      : Math.round(
          data.todayRecords.reduce((sum, item) => sum + item.model_latency_ms, 0) /
            data.todayRecords.length,
        );

  return (
    <AdminPageFrame
      title="运营工作台"
      description="聚焦今日批量生成、异常批次、配置健康度、发布状态、最近变更和推荐效果。"
      action={
        <Button className="rounded-full" variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          刷新
        </Button>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日批量生成结果</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">批次总数</p>
              <p className="kpi-value text-xl">{data.todayBatches.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">成功批次</p>
              <p className="kpi-value text-xl">{batchSuccessCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">部分失败</p>
              <p className="kpi-value text-xl">{batchPartialCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">失败 / 兜底</p>
              <p className="kpi-value text-xl">{batchFailureCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日发布状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-slate-500">已发布批次</p>
              <p className="kpi-value text-xl">{todayPublished.length}</p>
            </div>
            <div className="space-y-2">
              {todayPublished.length === 0 ? (
                <p className="text-sm text-slate-500">今日暂无已发布批次。</p>
              ) : (
                todayPublished.slice(0, 4).map((item) => (
                  <div
                    key={item.batch_id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <p className="font-mono text-slate-700">{item.batch_id}</p>
                    <p className="text-slate-500">{item.job_id ?? "无任务"} · {item.batch_type}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">待处理异常批次</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {abnormalBatches.length === 0 ? (
              <p className="text-sm text-slate-500">今日无异常批次。</p>
            ) : (
              abnormalBatches.slice(0, 6).map((batch) => (
                <div
                  key={batch.batch_id}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs text-amber-900">{batch.batch_id}</p>
                    <Badge variant="outline">{batch.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-amber-800">{batch.error_summary || "无错误摘要"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/admin/analytics/recommendation-records?batchId=${encodeURIComponent(
                          batch.batch_id,
                        )}`}
                      >
                        查看记录
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/admin/observability/traces?batchId=${encodeURIComponent(
                          batch.batch_id,
                        )}`}
                      >
                        查看链路
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">配置健康度</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {data.configHealth.map((item) => {
              const ratio = item.total === 0 ? 0 : (item.active / item.total) * 100;
              return (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">{item.label}</p>
                  <p className="kpi-value text-xl">
                    {item.active}/{item.total}
                  </p>
                  <p className="text-xs text-slate-500">启用率 {toPercent(ratio)}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">最近变更</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentLogs.length === 0 ? (
              <p className="text-sm text-slate-500">暂无配置变更记录。</p>
            ) : (
              data.recentLogs.map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-800">{log.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {log.entity_type} · {log.action} ·{" "}
                    {new Date(log.timestamp).toLocaleString("zh-CN")}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">推荐效果摘要</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">今日推荐记录</p>
                <p className="kpi-value text-xl">{data.todayRecords.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">已采纳记录</p>
                <p className="kpi-value text-xl">{adoptedCount}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">采纳率</p>
                <p className="kpi-value text-xl">{toPercent(adoptionRate)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">平均模型耗时</p>
                <p className="kpi-value text-xl">{avgLatency}ms</p>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button asChild variant="outline">
                <Link href="/admin/operations/recommendation-batches" className="gap-2">
                  批次中心
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/recommendation-records" className="gap-2">
                  记录复盘
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
