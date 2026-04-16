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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchReportEvents,
  fetchReportsSummary,
  type ReportsSummaryResponse,
} from "@/lib/frontstage/api";
import type { MetricEvent } from "@/lib/memory/types";

const EMPTY_SUMMARY: ReportsSummaryResponse = {
  entities: {
    products: { total: 0, active: 0 },
    dealers: { total: 0, active: 0 },
    suggestionTemplates: { total: 0, active: 0 },
    campaigns: { total: 0, active: 0 },
  },
  metrics: {
    sessionCount: 0,
    recommendationRequests: 0,
    weeklyFocusRequests: 0,
    cartOptimizationRequests: 0,
    explanationRequests: 0,
    addToCartFromSuggestion: 0,
    applyOptimizationCount: 0,
    thresholdReachedCount: 0,
    boxAdjustmentCount: 0,
    pairSuggestionAppliedCount: 0,
    totalCartAmountBefore: 0,
    totalCartAmountAfter: 0,
    totalRevenueLift: 0,
    averageModelLatencyMs: 0,
    totalModelCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    structuredOutputFailureCount: 0,
    customerSceneBreakdown: {},
    latestEvents: [],
  },
  recommendationRuns: {
    total: 0,
    generated: 0,
    partiallyApplied: 0,
    fullyApplied: 0,
    ignored: 0,
  },
};

const EVENT_LABELS: Record<string, string> = {
  recommendation_generated: "生成推荐",
  weekly_focus_generated: "生成周活动推荐",
  recommendation_applied: "采纳推荐",
  cart_optimized: "应用凑单优化",
  threshold_reached: "达到门槛",
  box_adjusted: "箱规调整",
  pair_item_added: "加购搭配品",
  explanation_viewed: "查看解释",
  config_updated: "更新配置",
};

const SCENE_LABELS: Record<string, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  threshold_topup: "门槛补差",
  box_pair_optimization: "箱规与搭配优化",
  admin_config: "后台配置",
};

export default function AnalyticsOverviewPage() {
  const [summary, setSummary] = useState<ReportsSummaryResponse>(EMPTY_SUMMARY);
  const [events, setEvents] = useState<MetricEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [eventQ, setEventQ] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<MetricEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadSummary = async () => {
    const nextSummary = await fetchReportsSummary();
    setSummary(nextSummary);
  };

  const loadEvents = async (input: { page: number; q: string }) => {
    setLoadingEvents(true);
    try {
      const params = new URLSearchParams({
        page: String(input.page),
        pageSize: "8",
        sortBy: "timestamp",
        sortOrder: "desc",
      });
      if (input.q.trim()) {
        params.set("q", input.q.trim());
      }
      const data = await fetchReportEvents(params);
      setEvents(data.items);
      setEventsTotal(data.total);
      setSelectedEvent((prev) =>
        data.items.some((item) => item.id === prev?.id) ? prev : data.items[0] ?? null,
      );
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadOverview = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      await Promise.all([loadSummary(), loadEvents({ page: 1, q: eventQ })]);
      setEventPage(1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载经营总览失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      void loadEvents({ page: eventPage, q: eventQ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPage]);

  const sceneBreakdown = Object.entries(summary.metrics.customerSceneBreakdown).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <AdminPageFrame
      title="经营总览"
      description="聚合经营 KPI 与运行分析，帮助识别推荐效果和运行稳定性。"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadOverview} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/audit-logs" className="gap-2">
              查看审计日志
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/admin/analytics/recommendations" className="gap-2">
              查看推荐记录
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">推荐请求数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{summary.metrics.recommendationRequests}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">优化请求数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{summary.metrics.cartOptimizationRequests}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">结构化失败数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">{summary.metrics.structuredOutputFailureCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">累计提升金额</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-2xl">¥{summary.metrics.totalRevenueLift}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">运行分析</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">平均模型耗时</p>
              <p className="kpi-value text-xl">{summary.metrics.averageModelLatencyMs}ms</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">模型调用总数</p>
              <p className="kpi-value text-xl">{summary.metrics.totalModelCalls}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">输入 Token 总量</p>
              <p className="kpi-value text-xl">{summary.metrics.totalInputTokens}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">输出 Token 总量</p>
              <p className="kpi-value text-xl">{summary.metrics.totalOutputTokens}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">推荐效果分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">总批次 {summary.recommendationRuns.total}</Badge>
              <Badge variant="outline">已生成 {summary.recommendationRuns.generated}</Badge>
              <Badge variant="outline">
                部分采纳 {summary.recommendationRuns.partiallyApplied}
              </Badge>
              <Badge variant="outline">完全采纳 {summary.recommendationRuns.fullyApplied}</Badge>
              <Badge variant="outline">未采纳 {summary.recommendationRuns.ignored}</Badge>
            </div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">场景分布</p>
              {sceneBreakdown.length === 0 ? (
                <p className="text-sm text-slate-500">暂无场景统计。</p>
              ) : (
                sceneBreakdown.map(([scene, count]) => (
                  <div key={scene} className="flex items-center justify-between text-sm">
                    <span>{SCENE_LABELS[scene] ?? scene}</span>
                    <span className="kpi-value">{count}</span>
                  </div>
                ))
              )}
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/admin/observability/traces" className="gap-2">
                前往链路观察
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">运行事件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <Input
                placeholder="按事件类型/客户/场景搜索"
                value={eventQ}
                onChange={(event) => setEventQ(event.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => {
                  setEventPage(1);
                  void loadEvents({ page: 1, q: eventQ });
                }}
                disabled={loadingEvents}
              >
                <Filter className="h-4 w-4" />
                查询事件
              </Button>
              <div className="flex items-center text-xs text-slate-500">总数 {eventsTotal}</div>
            </div>
            <div className="rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>事件</TableHead>
                    <TableHead>客户</TableHead>
                    <TableHead>场景</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingEvents ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        加载中...
                      </TableCell>
                    </TableRow>
                  ) : events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无事件
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((event) => (
                      <TableRow
                        key={event.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <TableCell className="font-mono text-xs">
                          {new Date(event.timestamp).toLocaleString("zh-CN")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {EVENT_LABELS[event.eventType] ?? event.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell>{event.customerName}</TableCell>
                        <TableCell>{SCENE_LABELS[event.scene] ?? event.scene}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}
                disabled={eventPage <= 1 || loadingEvents}
              >
                上一页
              </Button>
              <span>第 {eventPage} 页</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEventPage((prev) => prev + 1)}
                disabled={eventPage * 8 >= eventsTotal || loadingEvents}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">事件详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedEvent ? (
              <p className="text-sm text-slate-500">点击左侧事件查看明细。</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-800">
                    {EVENT_LABELS[selectedEvent.eventType] ?? selectedEvent.eventType}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedEvent.customerName} ·{" "}
                    {SCENE_LABELS[selectedEvent.scene] ?? selectedEvent.scene}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {new Date(selectedEvent.timestamp).toLocaleString("zh-CN")}
                  </p>
                </div>
                <pre className="max-h-80 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
