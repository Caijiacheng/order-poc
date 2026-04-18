"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type {
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
  currentBatches: RecommendationBatchRecord[];
  currentRecords: RecommendationRunRecord[];
  configHealth: ConfigHealthItem[];
};

const EMPTY_DATA: WorkbenchData = {
  currentBatches: [],
  currentRecords: [],
  configHealth: [],
};

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

      const [
        batchData,
        recordData,
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
        fetchHealthItem<ProductEntity>("商品信息", "/api/admin/products?"),
        fetchHealthItem<DealerEntity>("门店信息", "/api/admin/dealers?"),
        fetchHealthItem<RecommendationStrategyEntity>(
          "推荐方案",
          "/api/admin/recommendation-strategies?sceneGroup=purchase&",
        ),
        fetchHealthItem<CampaignEntity>("活动安排", "/api/admin/campaigns?"),
        fetchHealthItem<ExpressionTemplateEntity>(
          "推荐话术",
          "/api/admin/expression-templates?",
        ),
      ]);

      setData({
        currentBatches: batchData.items,
        currentRecords: recordData.items,
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

  const purchaseBatches = data.currentBatches;
  const purchaseRecords = data.currentRecords.filter(
    (item) => item.surface === "purchase" && item.generation_mode === "precomputed",
  );
  const checkoutRealtimeRecords = data.currentRecords.filter(
    (item) => item.surface === "checkout" && item.generation_mode === "realtime",
  );
  const publishedBatchIds = new Set(
    purchaseBatches
      .filter((item) => item.publication_status === "published")
      .map((item) => item.batch_id),
  );
  const publishedPurchaseRecords = purchaseRecords.filter(
    (item) => item.batch_id && publishedBatchIds.has(item.batch_id),
  );
  const publishedBatches = purchaseBatches.filter(
    (item) => item.publication_status === "published",
  );

  const purchaseAdoptedCount = publishedPurchaseRecords.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const purchaseAdoptionRate =
    publishedPurchaseRecords.length === 0
      ? 0
      : (purchaseAdoptedCount / publishedPurchaseRecords.length) * 100;
  const checkoutAdoptedCount = checkoutRealtimeRecords.filter((item) =>
    ["partially_applied", "fully_applied"].includes(item.status),
  ).length;
  const checkoutAdoptionRate =
    checkoutRealtimeRecords.length === 0
      ? 0
      : (checkoutAdoptedCount / checkoutRealtimeRecords.length) * 100;
  const checkoutAvgLatency =
    checkoutRealtimeRecords.length === 0
      ? 0
      : Math.round(
          checkoutRealtimeRecords.reduce((sum, item) => sum + item.model_latency_ms, 0) /
            checkoutRealtimeRecords.length,
        );

  return (
    <AdminPageFrame
      title="运营看板"
      action={
        <Button className="rounded-full" variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          刷新
        </Button>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">当前已发布采购建议</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{publishedPurchaseRecords.length}</p>
            <p className="text-slate-500">
              {publishedPurchaseRecords.length > 0
                ? `当前有 ${publishedPurchaseRecords.length} 条采购建议已发给门店，来自 ${publishedBatches.length} 个已发布批次。`
                : "当前还没有采购建议发给门店。"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">采购建议采纳情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{toPercent(purchaseAdoptionRate)}</p>
            <p className="text-slate-500">
              当前已发布采购建议共有 {publishedPurchaseRecords.length} 条，其中 {purchaseAdoptedCount} 条已被采纳。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">结算凑单采纳情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="kpi-value text-2xl">{toPercent(checkoutAdoptionRate)}</p>
            <p className="text-slate-500">
              当前共触发 {checkoutRealtimeRecords.length} 次凑单推荐，其中 {checkoutAdoptedCount} 次被采纳，平均耗时 {checkoutAvgLatency}ms。
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">采购建议准备情况</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">当前生成批次</p>
              <p className="kpi-value text-xl">{purchaseBatches.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">已发布批次</p>
              <p className="kpi-value text-xl">{publishedBatches.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
              <p className="text-slate-500">已发给门店建议</p>
              <p className="kpi-value text-xl">
                {publishedPurchaseRecords.length} 条
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">下一步先做什么</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {publishedBatches.length === 0
                ? "当前还没有发布批次，建议先检查生成结果，再决定是否发布。"
                : "当前已有批次发布，可继续查看门店建议和采纳情况。"}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button asChild variant="outline">
                <Link href="/admin/operations/recommendation-batches" className="gap-2">
                  查看生成批次
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/recommendation-records?view=purchase" className="gap-2">
                  查看采购建议记录
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/recommendation-records?view=checkout" className="gap-2">
                  查看结算实时记录
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/operations/generation-jobs" className="gap-2">
                  继续生成建议
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
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
      </section>
    </AdminPageFrame>
  );
}
