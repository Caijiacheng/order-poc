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
        fetchHealthItem<ProductEntity>("商品信息", "/api/admin/products?"),
        fetchHealthItem<DealerEntity>("门店信息", "/api/admin/dealers?"),
        fetchHealthItem<RecommendationStrategyEntity>(
          "推荐方案",
          "/api/admin/recommendation-strategies?",
        ),
        fetchHealthItem<CampaignEntity>("活动安排", "/api/admin/campaigns?"),
        fetchHealthItem<ExpressionTemplateEntity>(
          "推荐话术",
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
      setErrorMessage(error instanceof Error ? error.message : "加载今日看板失败");
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
  const latestPublished = todayPublished[0] ?? null;
  const latestLog = data.recentLogs[0] ?? null;

  return (
    <AdminPageFrame
      title="今日看板"
      description="先确认今天有没有发布、有没有异常、门店有没有带货，再决定下一步。"
      action={
        <Button className="rounded-full" variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          刷新
        </Button>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今天已发布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{todayPublished.length}</p>
            <p className="text-slate-500">
              {latestPublished
                ? `最近发布：${latestPublished.batch_id}`
                : "今天还没有发布任何建议批次。"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">待处理异常</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{abnormalBatches.length}</p>
            <p className="text-slate-500">
              {abnormalBatches.length === 0
                ? "今天没有需要排查的异常批次。"
                : "建议优先查看异常批次和执行过程。"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">门店采纳情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{toPercent(adoptionRate)}</p>
            <p className="text-slate-500">
              今天共有 {data.todayRecords.length} 条门店建议，其中 {adoptedCount} 条已被采纳。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">平均模型耗时</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{avgLatency}ms</p>
            <p className="text-slate-500">
              {data.todayRecords.length === 0
                ? "今天还没有实际门店建议耗时数据。"
                : "用来判断今天的生成链路是否明显变慢。"}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今天生成进度</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">今天共生成批次</p>
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
            <CardTitle className="text-lg">建议下一步</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {abnormalBatches.length > 0
                ? `今天有 ${abnormalBatches.length} 个异常批次，建议先排查异常，再决定是否重新生成。`
                : todayPublished.length === 0
                  ? "今天还没有发布批次，建议先检查生成结果，再决定是否发布。"
                  : "今天已有批次发布，可继续查看门店建议和采纳情况。"}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button asChild variant="outline">
                <Link href="/admin/operations/recommendation-batches" className="gap-2">
                  查看生成批次
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/recommendation-records" className="gap-2">
                  查看门店建议
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/operations/generation-jobs" className="gap-2">
                  继续生成建议单
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/overview" className="gap-2">
                  查看结果总览
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">需要处理的异常批次</CardTitle>
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
                    <p className="mt-1 text-xs text-amber-800">
                      {batch.error_summary || "无错误摘要"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/admin/analytics/recommendation-records?batchId=${encodeURIComponent(
                            batch.batch_id,
                          )}`}
                        >
                          查看门店建议
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/admin/observability/traces?batchId=${encodeURIComponent(
                            batch.batch_id,
                          )}`}
                        >
                          查看执行过程
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
              <CardTitle className="text-lg">最近改了什么</CardTitle>
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
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">基础信息是否齐全</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">今天最后一次动作</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {latestLog ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-800">{latestLog.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(latestLog.timestamp).toLocaleString("zh-CN")}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500">今天还没有新的后台操作记录。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </AdminPageFrame>
  );
}
