"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Filter, RefreshCw } from "lucide-react";

import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { requestJson, requestJsonWithMeta } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import { buildLangfuseTraceUrl } from "@/lib/frontstage/api";
import type {
  CopilotDraft,
  CopilotInputMode,
  CopilotJob,
  CopilotRun,
} from "@/lib/copilot/types";
import type {
  DealerEntity,
  RecommendationItemRecord,
  RecommendationRunRecord,
} from "@/lib/memory/types";

type RecommendationDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

type ReplayResponse = {
  batch?: {
    batch_id: string;
  };
  trace_id?: string;
  summary: string;
  generated_run_ids: string[];
};

type CopilotOverviewData = {
  total: number;
  rows: Array<{
    run: CopilotRun;
    job: CopilotJob | null;
    draft: CopilotDraft | null;
  }>;
};

type CopilotFilterState = {
  pageName: "all" | "/purchase" | "/order-submit";
  status: "all" | "running" | "succeeded" | "blocked" | "failed";
  runType: "all" | "autofill_order" | "explain_order";
  inputMode: "all" | CopilotInputMode;
};

type QueryState = {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  dateFrom: string;
  dateTo: string;
  customerId: string;
  skuId: string;
  status: string;
  adoptionStatus: string;
  batchId: string;
};

type RecordsView = "purchase" | "checkout";

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 10,
  sortBy: "created_at",
  sortOrder: "desc",
  dateFrom: "",
  dateTo: "",
  customerId: "",
  skuId: "",
  status: "",
  adoptionStatus: "",
  batchId: "",
};

const VIEW_CONFIG: Record<
  RecordsView,
  {
    title: string;
    surface: "purchase" | "checkout";
    generationMode: "precomputed" | "realtime";
  }
> = {
  purchase: {
    title: "采购建议记录",
    surface: "purchase",
    generationMode: "precomputed",
  },
  checkout: {
    title: "结算凑单记录",
    surface: "checkout",
    generationMode: "realtime",
  },
};

const SCENE_LABELS: Record<string, string> = {
  hot_sale_restock: "热销补货",
  stockout_restock: "缺货补货",
  campaign_stockup: "活动备货",
  checkout_optimization: "结算凑单",
  daily_recommendation: "采购建议",
  weekly_focus: "活动备货",
  box_pair_optimization: "结算凑单",
  threshold_topup: "门槛补差",
};

const STATUS_LABELS: Record<string, string> = {
  generated: "已出建议",
  partially_applied: "已采纳部分商品",
  fully_applied: "已采纳",
  ignored: "本轮未采纳",
  adopted: "已采纳",
  not_adopted: "未采纳",
  pending: "待门店处理",
  viewed: "已查看",
  explained: "已看依据",
  applied: "已加入购物车",
  rejected: "已明确不要",
  submitted_with_order: "随单下单",
  expired: "已失效",
};

function normalizeRecordsView(value: string | null): RecordsView {
  if (value === "checkout" || value === "checkout_optimization") {
    return "checkout";
  }
  return "purchase";
}

const COPILOT_STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  succeeded: "成功",
  blocked: "阻塞",
  failed: "失败",
};

const COPILOT_INPUT_MODE_LABELS: Record<CopilotInputMode, string> = {
  text: "文字",
  image: "图片",
  mixed: "混合",
};

function toSearchParams(query: QueryState, view: RecordsView) {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sortBy", query.sortBy);
  params.set("sortOrder", query.sortOrder);
  params.set("surface", VIEW_CONFIG[view].surface);
  params.set("generationMode", VIEW_CONFIG[view].generationMode);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.skuId) params.set("skuId", query.skuId);
  if (query.status) params.set("status", query.status);
  if (query.adoptionStatus) params.set("adoptionStatus", query.adoptionStatus);
  if (query.batchId && view === "purchase") params.set("batchId", query.batchId);
  return params;
}

function getLangfuseBaseUrl(meta: Record<string, unknown>) {
  const value = meta.langfuse_base_url;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL ?? "";
}

function getScenePresentationHint(scene: string) {
  if (scene === "hot_sale_restock") {
    return "这条建议会展示在采购页的“热销补货”卡片。";
  }
  if (scene === "stockout_restock") {
    return "这条建议会展示在采购页的“缺货补货”卡片。";
  }
  if (scene === "campaign_stockup") {
    return "这条建议会展示在采购页的“活动备货”卡片，并同步到活动专区。";
  }
  if (scene === "checkout_optimization") {
    return "这条建议来自结算页下单前的即时凑单推荐。";
  }
  return "这条建议来自当前业务记录。";
}

export default function RecommendationRecordsPage() {
  const searchParams = useSearchParams();

  const [view, setView] = useState<RecordsView>("purchase");
  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [records, setRecords] = useState<RecommendationRunRecord[]>([]);
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<(RecommendationDetail & { langfuseBaseUrl: string }) | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [loadingCopilot, setLoadingCopilot] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copilotFilter, setCopilotFilter] = useState<CopilotFilterState>({
    pageName: "all",
    status: "all",
    runType: "all",
    inputMode: "all",
  });
  const [copilotData, setCopilotData] = useState<CopilotOverviewData>({
    total: 0,
    rows: [],
  });

  const loadCopilotRuns = async (
    nextQuery = query,
    nextFilter = copilotFilter,
  ) => {
    setLoadingCopilot(true);
    try {
      const result = await requestJsonWithMeta<CopilotOverviewData>(
        `/api/admin/copilot/overview?${new URLSearchParams({
          limit: "30",
          customerId: nextQuery.customerId,
          dateFrom: nextQuery.dateFrom ? new Date(nextQuery.dateFrom).toISOString() : "",
          dateTo: nextQuery.dateTo ? new Date(nextQuery.dateTo).toISOString() : "",
          pageName: nextFilter.pageName === "all" ? "" : nextFilter.pageName,
          status: nextFilter.status === "all" ? "" : nextFilter.status,
          runType: nextFilter.runType === "all" ? "" : nextFilter.runType,
          inputMode: nextFilter.inputMode === "all" ? "" : nextFilter.inputMode,
        }).toString()}`,
      );
      setCopilotData(result.data);
    } catch {
      setCopilotData({
        total: 0,
        rows: [],
      });
    } finally {
      setLoadingCopilot(false);
    }
  };

  const loadRecords = async (nextQuery = query, nextView = view) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [result, dealerData] = await Promise.all([
        requestJsonWithMeta<ListResult<RecommendationRunRecord>>(
          `/api/admin/recommendation-records?${toSearchParams(nextQuery, nextView).toString()}`,
        ),
        requestJson<ListResult<DealerEntity>>(
          "/api/admin/dealers?page=1&pageSize=500&sortBy=customer_name&sortOrder=asc",
        ),
      ]);
      setRecords(result.data.items);
      setTotal(result.data.total);
      setLangfuseBaseUrl(getLangfuseBaseUrl(result.meta));
      setDealers(dealerData.items);
      void loadCopilotRuns(nextQuery, copilotFilter);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载建议记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const nextView = normalizeRecordsView(
      searchParams.get("view") ?? searchParams.get("scene"),
    );
    const nextQuery = {
      ...INITIAL_QUERY,
      batchId: searchParams.get("batchId") ?? "",
      customerId: searchParams.get("customerId") ?? "",
    };
    setView(nextView);
    setQuery(nextQuery);
    setDrawerOpen(false);
    setDetail(null);
    setSelectedRunId("");
    void loadRecords(nextQuery, nextView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<RecommendationDetail>(
        `/api/admin/recommendation-records/${id}`,
      );
      setDetail({
        ...result.data,
        langfuseBaseUrl: getLangfuseBaseUrl(result.meta),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载详情失败");
    } finally {
      setLoadingDetail(false);
    }
  };

  const openDetail = (id: string) => {
    setDrawerOpen(true);
    setSelectedRunId(id);
    void loadDetail(id);
  };

  const activeDetail =
    detail?.run.recommendation_run_id === selectedRunId ? detail : null;
  const traceLink = buildLangfuseTraceUrl(
    activeDetail?.run.trace_id,
    activeDetail?.langfuseBaseUrl || langfuseBaseUrl,
  );

  const canReplayCurrentRecord =
    activeDetail?.run.scene === "hot_sale_restock" ||
    activeDetail?.run.scene === "stockout_restock" ||
    activeDetail?.run.scene === "campaign_stockup" ||
    activeDetail?.run.scene === "checkout_optimization" ||
    activeDetail?.run.scene === "daily_recommendation" ||
    activeDetail?.run.scene === "weekly_focus" ||
    activeDetail?.run.scene === "box_pair_optimization" ||
    activeDetail?.run.scene === "threshold_topup";

  const replayCurrentRecord = async () => {
    if (!activeDetail || !canReplayCurrentRecord) {
      return;
    }
    setReplaying(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<ReplayResponse>(
        `/api/admin/recommendation-records/${activeDetail.run.recommendation_run_id}/replay`,
        {
          method: "POST",
        },
      );
      setSuccessMessage(
        result.data.batch
          ? `${result.data.summary}，新批次 ${result.data.batch.batch_id} 已生成。`
          : result.data.summary,
      );
      const nextQuery = {
        ...query,
        page: 1,
        batchId: view === "purchase" ? query.batchId : "",
        customerId: activeDetail.run.customer_id,
      };
      setQuery(nextQuery);
      await loadRecords(nextQuery, view);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重新生成失败");
    } finally {
      setReplaying(false);
    }
  };

  const drawerFooter = drawerOpen ? (
    <div className="flex flex-wrap gap-2">
      {traceLink ? (
        <Button asChild variant="outline">
          <a href={traceLink} target="_blank" rel="noreferrer" data-testid="trace-link">
            在 Langfuse 查看链路
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ) : (
        <Button variant="outline" disabled data-testid="trace-link">
          Langfuse 链路加载中
        </Button>
      )}
      {canReplayCurrentRecord ? (
        <Button variant="outline" onClick={() => void replayCurrentRecord()} disabled={replaying}>
          {replaying ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          重新生成这条建议
        </Button>
      ) : null}
      {activeDetail?.run.batch_id ? (
        <Button asChild variant="outline">
          <Link
            href={`/admin/observability/traces?batchId=${encodeURIComponent(
              activeDetail.run.batch_id,
            )}`}
          >
            查看同批次执行过程
          </Link>
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <AdminPageFrame
      title={VIEW_CONFIG[view].title}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-full"
            variant="outline"
            onClick={() => void loadRecords()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          {view === "purchase" ? (
            <Button asChild variant="outline">
              <Link href="/admin/operations/recommendation-batches">查看生成批次</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/admin/observability/traces">查看执行过程</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-8">
          <div className="space-y-1">
            <Label>开始时间</Label>
            <Input
              type="datetime-local"
              value={query.dateFrom}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateFrom: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>结束时间</Label>
            <Input
              type="datetime-local"
              value={query.dateTo}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateTo: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>经销商</Label>
            <Select
              value={query.customerId || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  customerId: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="全部经销商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部经销商</SelectItem>
                {dealers.map((dealer) => (
                  <SelectItem key={dealer.customer_id} value={dealer.customer_id}>
                    {dealer.customer_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>状态</Label>
            <Select
              value={query.status || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({ ...prev, status: value === "all" ? "" : value, page: 1 }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="generated">已出建议</SelectItem>
                  <SelectItem value="partially_applied">已采纳部分商品</SelectItem>
                  <SelectItem value="fully_applied">已采纳</SelectItem>
                  <SelectItem value="ignored">本轮未采纳</SelectItem>
                </SelectContent>
              </Select>
            </div>
          <div className="space-y-1">
            <Label>采纳状态</Label>
            <Select
              value={query.adoptionStatus || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  adoptionStatus: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="adopted">已采纳</SelectItem>
                <SelectItem value="not_adopted">未采纳</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>SKU 编码</Label>
            <Input
              value={query.skuId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, skuId: event.target.value, page: 1 }))
              }
            />
          </div>
          {view === "purchase" ? (
            <div className="space-y-1">
              <Label>生成批次</Label>
              <Input
                value={query.batchId}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, batchId: event.target.value, page: 1 }))
                }
              />
            </div>
          ) : null}
          <div className="flex items-end">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void loadRecords({ ...query, page: 1 }, view)}
            >
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">AI 下单助手运行视角</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/observability/traces">查看 AI 助手链路页</Link>
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            <Select
              value={copilotFilter.pageName}
              onValueChange={(value) =>
                setCopilotFilter((prev) => ({
                  ...prev,
                  pageName: value as CopilotFilterState["pageName"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部页面</SelectItem>
                <SelectItem value="/purchase">/purchase</SelectItem>
                <SelectItem value="/order-submit">/order-submit</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={copilotFilter.status}
              onValueChange={(value) =>
                setCopilotFilter((prev) => ({
                  ...prev,
                  status: value as CopilotFilterState["status"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
                <SelectItem value="succeeded">成功</SelectItem>
                <SelectItem value="blocked">阻塞</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={copilotFilter.runType}
              onValueChange={(value) =>
                setCopilotFilter((prev) => ({
                  ...prev,
                  runType: value as CopilotFilterState["runType"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="autofill_order">autofill_order</SelectItem>
                <SelectItem value="explain_order">explain_order</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={copilotFilter.inputMode}
              onValueChange={(value) =>
                setCopilotFilter((prev) => ({
                  ...prev,
                  inputMode: value as CopilotFilterState["inputMode"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部输入方式</SelectItem>
                <SelectItem value="text">文字</SelectItem>
                <SelectItem value="image">图片</SelectItem>
                <SelectItem value="mixed">混合</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => void loadCopilotRuns(query, copilotFilter)}
              disabled={loadingCopilot}
            >
              {loadingCopilot ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Filter className="h-4 w-4" />
              )}
              刷新 AI 助手视图
            </Button>
          </div>
          <div className="space-y-2">
            {copilotData.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                当前筛选下暂无 AI 助手运行记录。
              </p>
            ) : (
              copilotData.rows.slice(0, 6).map((row) => {
                const traceUrl = buildLangfuseTraceUrl(row.run.trace_id, langfuseBaseUrl);
                return (
                  <div
                    key={row.run.run_id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-slate-700">{row.run.run_id}</p>
                      <Badge variant="outline">
                        {COPILOT_STATUS_LABELS[row.run.status] ?? row.run.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {row.run.page_name} · {row.run.run_type} ·{" "}
                      {new Date(row.run.created_at).toLocaleString("zh-CN")}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      输入：{COPILOT_INPUT_MODE_LABELS[row.run.input_mode] ?? row.run.input_mode} ·{" "}
                      {row.job?.status ? `job=${row.job.status}` : "job=-"} ·{" "}
                      {row.draft?.status ? `draft=${row.draft.status}` : "draft=-"}
                    </p>
                    {traceUrl ? (
                      <a
                        href={traceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline underline-offset-2"
                      >
                        打开 Langfuse 链路
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="recommendation-report-table">
        <CardContent className="space-y-4 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>记录编号</TableHead>
                <TableHead>生成批次</TableHead>
                <TableHead>经销商</TableHead>
                <TableHead>建议类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">耗时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    当前筛选条件下暂无记录。
                  </TableCell>
                </TableRow>
              ) : (
                records.map((row) => (
                  <TableRow
                    key={row.recommendation_run_id}
                    className="cursor-pointer"
                    onClick={() => openDetail(row.recommendation_run_id)}
                  >
                    <TableCell className="font-mono text-xs">{row.recommendation_run_id}</TableCell>
                    <TableCell className="font-mono text-xs">{row.batch_id ?? "-"}</TableCell>
                    <TableCell>{row.customer_name}</TableCell>
                    <TableCell>{SCENE_LABELS[row.scene] ?? row.scene}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{row.model_latency_ms}ms</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-4 pb-4 text-xs text-slate-500">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = { ...query, page: Math.max(1, query.page - 1) };
                setQuery(next);
                void loadRecords(next, view);
              }}
              disabled={query.page <= 1 || loading}
            >
              上一页
            </Button>
            <span>
              总数 {total}，当前页 {query.page}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = { ...query, page: query.page + 1 };
                setQuery(next);
                void loadRecords(next, view);
              }}
              disabled={query.page * query.pageSize >= total || loading}
            >
              下一页
            </Button>
          </div>
        </CardContent>
      </Card>

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            setSelectedRunId("");
            setDetail(null);
          }
        }}
        title={activeDetail ? `${activeDetail.run.customer_name} · ${SCENE_LABELS[activeDetail.run.scene] ?? activeDetail.run.scene}` : "建议详情"}
        footer={drawerFooter}
      >
        {loadingDetail && !activeDetail ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            详情加载中...
          </div>
        ) : !activeDetail ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            当前没有可展示的记录。
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-xs text-slate-500">记录编号</p>
              <p className="mt-1 font-mono text-xs text-slate-700">
                {activeDetail.run.recommendation_run_id}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">经销商</p>
                  <p className="text-sm text-slate-900">{activeDetail.run.customer_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">建议类型</p>
                  <p className="text-sm text-slate-900">
                    {SCENE_LABELS[activeDetail.run.scene] ?? activeDetail.run.scene}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    {view === "purchase" ? "生成批次" : "触发状态"}
                  </p>
                  <p className="text-sm text-slate-900">
                    {view === "purchase"
                      ? activeDetail.run.batch_id ?? "未归入批次"
                      : STATUS_LABELS[activeDetail.run.status] ?? activeDetail.run.status}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">当前状态</p>
                  <p className="text-sm text-slate-900">
                    {STATUS_LABELS[activeDetail.run.status] ?? activeDetail.run.status}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              {getScenePresentationHint(activeDetail.run.scene)}
            </div>

            <section className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">建议商品</p>
              <div className="space-y-2">
                {activeDetail.items.slice(0, 8).map((item) => (
                  <div
                    key={item.recommendation_item_id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  >
                    <p className="font-medium text-slate-900">{item.sku_name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      建议数量 {item.suggested_qty} ·{" "}
                      {STATUS_LABELS[item.final_status] ?? item.final_status}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">发送给 AI 的内容</p>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                {activeDetail.run.prompt_snapshot}
              </pre>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">AI 返回结果</p>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                {activeDetail.run.response_snapshot ?? "当前记录暂无 AI 返回结果。"}
              </pre>
            </div>
          </>
        )}
      </AdminDrawer>
    </AdminPageFrame>
  );
}
