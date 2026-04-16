"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Filter, RefreshCw } from "lucide-react";

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
import {
  buildLangfuseTraceUrl,
  fetchRecommendationRunDetail,
  fetchRecommendationRuns,
} from "@/lib/frontstage/api";
import type { RecommendationItemRecord, RecommendationRunRecord } from "@/lib/memory/types";

type RecommendationDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  dateFrom: string;
  dateTo: string;
  customerId: string;
  scene: string;
  skuId: string;
  adoptionStatus: string;
  modelName: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 10,
  q: "",
  status: "",
  sortBy: "created_at",
  sortOrder: "desc",
  dateFrom: "",
  dateTo: "",
  customerId: "",
  scene: "",
  skuId: "",
  adoptionStatus: "",
  modelName: "",
};

const SCENE_LABELS: Record<string, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  box_pair_optimization: "箱规与搭配优化",
  threshold_topup: "门槛补差",
};

const STATUS_LABELS: Record<string, string> = {
  generated: "已生成",
  partially_applied: "部分采纳",
  fully_applied: "完全采纳",
  ignored: "已忽略",
  adopted: "已采纳",
  not_adopted: "未采纳",
  pending: "待处理",
  viewed: "已查看",
  explained: "已解释",
  applied: "已应用",
  rejected: "已拒绝",
  submitted_with_order: "随单提交",
  expired: "已失效",
};

function toSearchParams(query: QueryState) {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sortBy", query.sortBy);
  params.set("sortOrder", query.sortOrder);
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.scene) params.set("scene", query.scene);
  if (query.skuId) params.set("skuId", query.skuId);
  if (query.adoptionStatus) params.set("adoptionStatus", query.adoptionStatus);
  if (query.modelName) params.set("modelName", query.modelName);
  return params;
}

export default function RecommendationRecordsPage() {
  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [records, setRecords] = useState<RecommendationRunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<(RecommendationDetail & { langfuseBaseUrl: string }) | null>(
    null,
  );
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadRecords = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await fetchRecommendationRuns(toSearchParams(nextQuery));
      setRecords(result.list.items);
      setTotal(result.list.total);
      setLangfuseBaseUrl(result.langfuseBaseUrl);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载推荐记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords(INITIAL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    setErrorMessage("");
    try {
      const result = await fetchRecommendationRunDetail(id);
      setDetail(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载详情失败");
    } finally {
      setLoadingDetail(false);
    }
  };

  const traceLink = buildLangfuseTraceUrl(
    detail?.run.trace_id,
    detail?.langfuseBaseUrl || langfuseBaseUrl,
  );

  return (
    <AdminPageFrame
      title="推荐记录"
      description="查询推荐批次与条目明细（只读），支持筛选、详情钻取与链路追踪跳转。"
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
          <Button asChild variant="outline">
            <Link href="/admin/observability/traces">前往链路观察</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-7">
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
            <Label>经销商编码</Label>
            <Input
              value={query.customerId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, customerId: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>场景</Label>
            <Select
              value={query.scene || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({ ...prev, scene: value === "all" ? "" : value, page: 1 }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部场景</SelectItem>
                <SelectItem value="daily_recommendation">日常补货</SelectItem>
                <SelectItem value="weekly_focus">周活动备货</SelectItem>
                <SelectItem value="box_pair_optimization">箱规与搭配优化</SelectItem>
                <SelectItem value="threshold_topup">门槛补差</SelectItem>
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
                <SelectItem value="generated">已生成未处理</SelectItem>
                <SelectItem value="partially_applied">部分采纳</SelectItem>
                <SelectItem value="fully_applied">完全采纳</SelectItem>
                <SelectItem value="ignored">已忽略</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void loadRecords({ ...query, page: 1 })}
            >
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card data-testid="recommendation-report-table">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>批次 ID</TableHead>
                  <TableHead>经销商</TableHead>
                  <TableHead>场景</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((row) => (
                    <TableRow
                      key={row.recommendation_run_id}
                      className="cursor-pointer"
                      onClick={() => void loadDetail(row.recommendation_run_id)}
                    >
                      <TableCell className="font-mono text-xs">{row.recommendation_run_id}</TableCell>
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">批次详情</p>
            {!detail ? (
              <p className="text-sm text-slate-500">点击左侧批次行查看详情</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-mono text-xs">{detail.run.recommendation_run_id}</p>
                  <p className="mt-1">
                    {detail.run.customer_name} ·{" "}
                    {SCENE_LABELS[detail.run.scene] ?? detail.run.scene}
                  </p>
                  <p className="text-xs text-slate-500">追踪 ID：{detail.run.trace_id ?? "-"}</p>
                  <p className="text-xs text-slate-500">
                    状态：{STATUS_LABELS[detail.run.status] ?? detail.run.status}
                  </p>
                  {traceLink ? (
                    <a
                      href={traceLink}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="trace-link"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline underline-offset-2"
                    >
                      在 Langfuse 打开链路
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Langfuse 链路入口不可用</p>
                  )}
                </div>
                <div className="space-y-2">
                  {detail.items.map((item) => (
                    <div
                      key={item.recommendation_item_id}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                    >
                      <p className="font-medium">{item.sku_name}</p>
                      <p className="text-xs text-slate-500">
                        {item.sku_id} · 建议数量 {item.suggested_qty} ·{" "}
                        {STATUS_LABELS[item.final_status] ?? item.final_status}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">提示词快照</p>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                    {detail.run.prompt_snapshot}
                  </pre>
                </div>
              </>
            )}
            {loadingDetail ? <p className="text-xs text-slate-500">详情加载中...</p> : null}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...query, page: Math.max(1, query.page - 1) };
                  setQuery(next);
                  void loadRecords(next);
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
                  void loadRecords(next);
                }}
                disabled={query.page * query.pageSize >= total || loading}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
