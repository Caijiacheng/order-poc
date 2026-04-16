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
import type { AuditLogEvent, MetricsStore } from "@/lib/memory/types";

type SummaryResponse = {
  entities: {
    products: { total: number; active: number };
    dealers: { total: number; active: number };
    suggestionTemplates: { total: number; active: number };
    campaigns: { total: number; active: number };
  };
  metrics: MetricsStore;
  recommendationRuns: {
    total: number;
    generated: number;
    partiallyApplied: number;
    fullyApplied: number;
    ignored: number;
  };
};

const EMPTY_SUMMARY: SummaryResponse = {
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

const QUICK_ENTRIES = [
  {
    href: "/admin/master-data/products",
    label: "商品档案",
    description: "维护上架 SKU、价格与箱规。",
  },
  {
    href: "/admin/master-data/dealers",
    label: "经销商档案",
    description: "维护客户基础信息与经营画像。",
  },
  {
    href: "/admin/strategy/recommendation-templates",
    label: "推荐模板",
    description: "维护分场景推荐参考模板。",
  },
  {
    href: "/admin/strategy/rules",
    label: "推荐规则",
    description: "维护补货门槛与凑单逻辑规则。",
  },
  {
    href: "/admin/strategy/ai-expression",
    label: "AI 表达配置",
    description: "统一推荐理由表达与生成风格。",
  },
  {
    href: "/admin/analytics/recommendations",
    label: "推荐记录",
    description: "查看批次结果、采纳状态与明细。",
  },
] as const;

function toPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }
  return `${value.toFixed(1)}%`;
}

export default function WorkbenchOverviewPage() {
  const [summary, setSummary] = useState<SummaryResponse>(EMPTY_SUMMARY);
  const [auditLogs, setAuditLogs] = useState<AuditLogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, auditData] = await Promise.all([
        requestJson<SummaryResponse>("/api/admin/reports/summary"),
        requestJson<ListResult<AuditLogEvent>>(
          "/api/admin/reports/audit-logs?page=1&pageSize=6&sortBy=timestamp&sortOrder=desc",
        ),
      ]);
      setSummary(summaryData);
      setAuditLogs(auditData.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const adoptionRate =
    summary.metrics.recommendationRequests === 0
      ? 0
      : (summary.metrics.addToCartFromSuggestion / summary.metrics.recommendationRequests) * 100;

  const configHealthItems = [
    {
      label: "商品档案",
      active: summary.entities.products.active,
      total: summary.entities.products.total,
    },
    {
      label: "经销商档案",
      active: summary.entities.dealers.active,
      total: summary.entities.dealers.total,
    },
    {
      label: "推荐模板",
      active: summary.entities.suggestionTemplates.active,
      total: summary.entities.suggestionTemplates.total,
    },
    {
      label: "活动策略",
      active: summary.entities.campaigns.active,
      total: summary.entities.campaigns.total,
    },
  ] as const;

  return (
    <AdminPageFrame
      title="运营工作台"
      description="聚焦今日运行状态、配置健康度、快捷入口、最近变更与推荐效果摘要。"
      action={
        <Button className="rounded-full" variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          刷新
        </Button>
      }
    >
      <FeedbackBanner kind="error" message={error} />

      <section className="grid gap-4 xl:grid-cols-2" data-testid="admin-workbench-kpis">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日运行状态</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">推荐生成次数</p>
              <p className="kpi-value text-xl">{summary.metrics.recommendationRequests}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">订单优化次数</p>
              <p className="kpi-value text-xl">{summary.metrics.cartOptimizationRequests}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">解释触发次数</p>
              <p className="kpi-value text-xl">{summary.metrics.explanationRequests}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">平均模型耗时</p>
              <p className="kpi-value text-xl">{summary.metrics.averageModelLatencyMs}ms</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">结构化失败次数</p>
              <p className="kpi-value text-xl">{summary.metrics.structuredOutputFailureCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">配置健康度</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            {configHealthItems.map((item) => {
              const ratio = item.total === 0 ? 0 : (item.active / item.total) * 100;
              return (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">{item.label}</p>
                  <p className="kpi-value text-xl">
                    {item.active}/{item.total}
                  </p>
                  <p className="text-xs text-slate-500">
                    启用率 {toPercent(ratio)} · {item.active > 0 ? "可参与运行" : "待补充配置"}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">快捷入口</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {QUICK_ENTRIES.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="group rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <p className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                {entry.label}
                <ArrowRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:translate-x-0.5" />
              </p>
              <p className="mt-1 text-xs text-slate-500">{entry.description}</p>
            </Link>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">最近变更</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500">暂无配置变更记录。</p>
            ) : (
              auditLogs.map((log) => (
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
                <p className="text-slate-500">建议采纳次数</p>
                <p className="kpi-value text-xl">{summary.metrics.addToCartFromSuggestion}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">优化应用次数</p>
                <p className="kpi-value text-xl">{summary.metrics.applyOptimizationCount}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <p className="text-slate-500">累计提升金额</p>
                <p className="kpi-value text-xl">¥{summary.metrics.totalRevenueLift}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">总批次 {summary.recommendationRuns.total}</Badge>
              <Badge variant="outline">已生成 {summary.recommendationRuns.generated}</Badge>
              <Badge variant="outline">
                部分采纳 {summary.recommendationRuns.partiallyApplied}
              </Badge>
              <Badge variant="outline">
                完全采纳 {summary.recommendationRuns.fullyApplied}
              </Badge>
              <Badge variant="outline">未采纳 {summary.recommendationRuns.ignored}</Badge>
            </div>
            <p className="text-xs text-slate-500">建议采纳率：{toPercent(adoptionRate)}</p>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
