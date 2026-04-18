"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Filter, RefreshCw } from "lucide-react";

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
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { RecommendationBatchRecord } from "@/lib/memory/types";

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
  dateFrom: string;
  dateTo: string;
  jobId: string;
  customerId: string;
  scene: string;
  status: string;
  publicationStatus: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 12,
  q: "",
  dateFrom: "",
  dateTo: "",
  jobId: "",
  customerId: "",
  scene: "",
  status: "",
  publicationStatus: "",
};

const BATCH_TYPE_LABELS: Record<RecommendationBatchRecord["batch_type"], string> = {
  scheduled_generation: "定时生成",
  sample_generation: "抽样试生成",
  frontstage_realtime: "前台实时",
  manual_replay: "人工补跑",
};

const STATUS_LABELS: Record<RecommendationBatchRecord["status"], string> = {
  queued: "排队中",
  running: "执行中",
  success: "成功",
  partial_failed: "部分失败",
  failed: "失败",
  cancelled: "已取消",
  fallback_served: "兜底回放",
};

const PUBLICATION_LABELS: Record<RecommendationBatchRecord["publication_status"], string> = {
  unpublished: "未发布",
  ready: "待发布",
  published: "已发布",
};

function toSearchParams(query: QueryState) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sortBy: "created_at",
    sortOrder: "desc",
  });
  if (query.q) params.set("q", query.q.trim());
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.jobId) params.set("jobId", query.jobId.trim());
  if (query.customerId) params.set("customerId", query.customerId.trim());
  if (query.scene) params.set("scene", query.scene);
  if (query.status) params.set("status", query.status);
  if (query.publicationStatus) {
    params.set("publicationStatus", query.publicationStatus);
  }
  return params;
}

export default function RecommendationBatchesPage() {
  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [rows, setRows] = useState<RecommendationBatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<RecommendationBatchRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadBatches = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<RecommendationBatchRecord>>(
        `/api/admin/recommendation-batches?${toSearchParams(nextQuery).toString()}`,
      );
      setRows(data.items);
      setTotal(data.total);
      setSelected((prev) =>
        data.items.some((item) => item.batch_id === prev?.batch_id)
          ? prev
          : (data.items[0] ?? null),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载生成批次失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBatches(INITIAL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminPageFrame
      title="生成批次"
      description="先按批次看生成结果，再继续查看门店建议和执行过程。"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadBatches()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/operations/generation-jobs" className="gap-2">
              查看生成任务
              <ArrowRight className="h-4 w-4" />
            </Link>
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
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-9">
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
            <Label>任务 ID</Label>
            <Input
              value={query.jobId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, jobId: event.target.value, page: 1 }))
              }
              placeholder="job_xxx"
            />
          </div>
          <div className="space-y-1">
            <Label>经销商 ID</Label>
            <Input
              value={query.customerId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, customerId: event.target.value, page: 1 }))
              }
              placeholder="customer_xxx"
            />
          </div>
          <div className="space-y-1">
            <Label>场景</Label>
            <Select
              value={query.scene || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  scene: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部场景</SelectItem>
                <SelectItem value="daily_recommendation">日常补货</SelectItem>
                <SelectItem value="weekly_focus">周活动备货</SelectItem>
                <SelectItem value="threshold_topup">门槛补差</SelectItem>
                <SelectItem value="box_pair_optimization">箱规与搭配优化</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>批次状态</Label>
            <Select
              value={query.status || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  status: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="queued">排队中</SelectItem>
                <SelectItem value="running">执行中</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="partial_failed">部分失败</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
                <SelectItem value="fallback_served">兜底回放</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>发布状态</Label>
            <Select
              value={query.publicationStatus || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  publicationStatus: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="unpublished">未发布</SelectItem>
                <SelectItem value="ready">待发布</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>关键词</Label>
            <Input
              value={query.q}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, q: event.target.value, page: 1 }))
              }
              placeholder="batch_id / trace_id"
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void loadBatches({ ...query, page: 1 })}
            >
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>批次 ID</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>任务 / 经销商</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">关联 run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      暂无批次
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.batch_id}
                      className="cursor-pointer"
                      onClick={() => setSelected(row)}
                    >
                      <TableCell className="font-mono text-xs">{row.batch_id}</TableCell>
                      <TableCell className="text-sm">
                        {BATCH_TYPE_LABELS[row.batch_type]}
                        <p className="text-xs text-slate-500">{row.trigger_source}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        <p className="font-mono text-xs text-slate-700">{row.job_id ?? "-"}</p>
                        <p className="font-mono text-xs text-slate-500">{row.customer_id ?? "-"}</p>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={row.status === "success" ? "secondary" : "outline"}>
                            {STATUS_LABELS[row.status]}
                          </Badge>
                          <div>
                            <Badge variant="outline">
                              {PUBLICATION_LABELS[row.publication_status]}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.related_run_ids.length}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">这次生成详情</p>
            {!selected ? (
              <p className="text-sm text-slate-500">点击左侧批次查看详情。</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-mono text-xs">{selected.batch_id}</p>
                  <p className="mt-1">
                    {BATCH_TYPE_LABELS[selected.batch_type]} ·{" "}
                    {STATUS_LABELS[selected.status]}
                  </p>
                  <p className="text-xs text-slate-500">
                    发布时间状态：{PUBLICATION_LABELS[selected.publication_status]}
                  </p>
                  <p className="text-xs text-slate-500">
                    开始：{new Date(selected.started_at).toLocaleString("zh-CN")}
                  </p>
                  <p className="text-xs text-slate-500">
                    结束：
                    {selected.finished_at
                      ? ` ${new Date(selected.finished_at).toLocaleString("zh-CN")}`
                      : " -"}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    trace_id: {selected.trace_id ?? "-"}
                  </p>
                </div>

                {selected.error_summary ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                    {selected.error_summary}
                  </div>
                ) : null}

                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">
                    关联 run（{selected.related_run_ids.length}）
                  </p>
                  <div className="max-h-32 space-y-1 overflow-auto">
                    {selected.related_run_ids.length === 0 ? (
                      <p className="text-xs text-slate-500">无关联 run</p>
                    ) : (
                      selected.related_run_ids.map((runId) => (
                        <p key={runId} className="font-mono text-xs text-slate-700">
                          {runId}
                        </p>
                      ))
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  {selected.customer_id ? (
                    <Button asChild variant="outline">
                      <Link
                        href={`/admin/analytics/recommendation-records?batchId=${encodeURIComponent(
                          selected.batch_id,
                        )}&customerId=${encodeURIComponent(selected.customer_id)}`}
                        className="gap-2"
                      >
                        查看该经销商记录
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline">
                    <Link
                      href={`/admin/analytics/recommendation-records?batchId=${encodeURIComponent(
                        selected.batch_id,
                      )}`}
                      className="gap-2"
                    >
                      查看门店建议
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link
                      href={`/admin/observability/traces?batchId=${encodeURIComponent(
                        selected.batch_id,
                      )}`}
                      className="gap-2"
                    >
                      查看执行过程
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </>
            )}

            <div className="flex items-center justify-between text-xs text-slate-500">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...query, page: Math.max(1, query.page - 1) };
                  setQuery(next);
                  void loadBatches(next);
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
                  void loadBatches(next);
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
